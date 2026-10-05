import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { allActionMeta, runHubAction } from '@/lib/hub-actions/catalog'
import { getAssistantSettings } from '@/lib/hub-actions/settings'
import {
  AMBER_ACTING_ACTIONS,
  amberActingAction,
  getAmberApproverIds,
  getAmberModes,
  resolveAmberActor,
  type AmberMode,
} from '@/lib/hub-actions/amber'
import { amberActionStats } from '@/lib/hub-actions/amber-queue'
import { getMorningSettings } from '@/lib/amber-run'

// Admin → AI → Amber's account: what she may do on her own (off / approve /
// auto per action), who approves, and her track record per action.
//
// Nothing switches to automatic by itself: the stats are shown so an admin can
// decide (Ben, Oct 5 2026 — the 50-approval rule in the PRD was Claude's guess).

export const dynamic = 'force-dynamic'

const MODES: AmberMode[] = ['off', 'approve', 'auto']

async function guard() {
  const auth = await requireAdminArea('ai')
  if (!auth.ok || !auth.company_id || !auth.user) return null
  return { companyId: auth.company_id, userId: auth.user.id }
}

export async function GET() {
  const g = await guard()
  if (!g) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient()

  const [settings, modes, approverIds, stats, actor, { data: profiles }, { data: hubUsers }, morning, { data: rooms }, { data: runs }] = await Promise.all([
    getAssistantSettings(admin, g.companyId),
    getAmberModes(admin, g.companyId),
    getAmberApproverIds(admin, g.companyId),
    amberActionStats(admin, g.companyId),
    resolveAmberActor(admin, g.companyId),
    admin
      .from('user_profiles')
      .select('id, role, can_admin_ai, locked_at, deactivated_at')
      .eq('company_id', g.companyId),
    admin.from('hub_users').select('id, display_name, is_bot').eq('company_id', g.companyId),
    getMorningSettings(admin, g.companyId),
    admin
      .from('rooms')
      .select('id, name, is_private')
      .eq('company_id', g.companyId)
      .is('archived_at', null)
      .order('name', { ascending: true }),
    admin
      .from('amber_runs')
      .select('id, kind, run_date, status, started_at, finished_at, model, input_tokens, output_tokens, model_calls, tool_calls, queued, est_cost_usd, error')
      .eq('company_id', g.companyId)
      .order('started_at', { ascending: false })
      .limit(15),
  ])

  const meta = new Map(allActionMeta().map((m) => [m.name, m]))
  const actions = Object.entries(AMBER_ACTING_ACTIONS).map(([name, a]) => {
    const m = meta.get(name)
    const companyAllowed = m
      ? m.defaultOn
        ? !settings.disabledActions.includes(name)
        : settings.enabledActions.includes(name)
      : false
    return {
      name,
      label: a.label,
      autoAllowed: a.autoAllowed,
      mode: modes[name] ?? 'off',
      companyAllowed,
      stats: stats[name] ?? { approved: 0, edited: 0, rejected: 0, auto: 0, failed: 0 },
    }
  })

  // Approvers are chosen from people who can open the queue (/hub/amber is
  // gated on can_admin_ai), so nobody is picked who could never see it.
  const nameById = new Map(
    ((hubUsers || []) as Array<{ id: string; display_name: string | null; is_bot: boolean | null }>)
      .filter((u) => !u.is_bot)
      .map((u) => [u.id, u.display_name || '(no name)']),
  )
  const people = ((profiles || []) as Array<{
    id: string
    role: string | null
    can_admin_ai: boolean | null
    locked_at: string | null
    deactivated_at: string | null
  }>)
    .filter((p) => nameById.has(p.id) && !p.locked_at && !p.deactivated_at && (p.role === 'admin' || p.can_admin_ai === true))
    .map((p) => ({ id: p.id, name: nameById.get(p.id) as string }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({
    hasAccount: Boolean(actor),
    assistantEnabled: settings.enabled,
    actions,
    approverIds,
    people,
    morning,
    rooms: ((rooms || []) as Array<{ id: string; name: string | null; is_private: boolean | null }>).map((r) => ({
      id: r.id,
      name: (r.name || 'unnamed').trim(),
      isPrivate: r.is_private === true,
    })),
    runs: runs ?? [],
  })
}

export async function PUT(request: Request) {
  const g = await guard()
  if (!g) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient()
  let body: {
    modes?: Record<string, string>
    approverIds?: unknown
    morning?: { enabled?: unknown; time?: unknown; days?: unknown; roomId?: unknown }
  } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  if (body.modes) {
    const rows = []
    for (const [action, mode] of Object.entries(body.modes)) {
      const a = amberActingAction(action)
      if (!a) return NextResponse.json({ error: `Unknown action ${action}` }, { status: 400 })
      if (!MODES.includes(mode as AmberMode)) return NextResponse.json({ error: `Bad mode ${mode}` }, { status: 400 })
      if (mode === 'auto' && !a.autoAllowed) {
        return NextResponse.json({ error: `${a.label} reaches customers, so it always needs approval.` }, { status: 400 })
      }
      rows.push({ company_id: g.companyId, action, mode, updated_by: g.userId, updated_at: new Date().toISOString() })
    }
    if (rows.length) {
      const { error } = await admin.from('amber_action_modes').upsert(rows, { onConflict: 'company_id,action' })
      if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
    }
  }

  if (body.approverIds !== undefined) {
    if (!Array.isArray(body.approverIds) || body.approverIds.some((x) => typeof x !== 'string')) {
      return NextResponse.json({ error: 'approverIds must be a list of ids' }, { status: 400 })
    }
    // Only people of THIS company who can open the queue.
    const ids = [...new Set(body.approverIds as string[])]
    const { data: valid } = ids.length
      ? await admin.from('user_profiles').select('id, role, can_admin_ai').eq('company_id', g.companyId).in('id', ids)
      : { data: [] }
    const keep = ((valid || []) as Array<{ id: string; role: string | null; can_admin_ai: boolean | null }>)
      .filter((p) => p.role === 'admin' || p.can_admin_ai === true)
      .map((p) => p.id)
    // Upsert: a company that never opened the Assistant tab has no row yet.
    const { error } = await admin
      .from('hub_assistant_settings')
      .upsert({ company_id: g.companyId, amber_approver_ids: keep }, { onConflict: 'company_id' })
    if (error) return NextResponse.json({ error: 'Could not save approvers' }, { status: 500 })
  }

  if (body.morning) {
    const m = body.morning
    const patch: Record<string, unknown> = {}
    if (m.enabled !== undefined) patch.amber_morning_enabled = m.enabled === true
    if (m.time !== undefined) {
      if (typeof m.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(m.time)) {
        return NextResponse.json({ error: 'Time must be HH:MM' }, { status: 400 })
      }
      patch.amber_morning_time = m.time
    }
    if (m.days !== undefined) {
      if (!Array.isArray(m.days) || m.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
        return NextResponse.json({ error: 'Days must be 0–6' }, { status: 400 })
      }
      patch.amber_morning_days = [...new Set(m.days as number[])].sort()
    }
    if (m.roomId !== undefined) {
      if (m.roomId === null || m.roomId === '') patch.amber_morning_room_id = null
      else {
        // Only a room of THIS company.
        const { data: room } = await admin
          .from('rooms')
          .select('id')
          .eq('company_id', g.companyId)
          .eq('id', String(m.roomId))
          .maybeSingle()
        if (!room) return NextResponse.json({ error: 'Unknown room' }, { status: 400 })
        patch.amber_morning_room_id = (room as { id: string }).id
      }
    }
    if (Object.keys(patch).length) {
      const { error } = await admin
        .from('hub_assistant_settings')
        .upsert({ company_id: g.companyId, ...patch }, { onConflict: 'company_id' })
      if (error) return NextResponse.json({ error: 'Could not save the morning summary settings' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}

// POST = queue a harmless test item: Amber proposes DMing the admin who pressed
// the button. Goes through the real path (her account, her modes, the queue), so
// approving it proves the whole loop end to end.
export async function POST() {
  const g = await guard()
  if (!g) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient()
  const actor = await resolveAmberActor(admin, g.companyId)
  if (!actor) return NextResponse.json({ error: 'This company has no Amber account in the Hub.' }, { status: 409 })
  const settings = await getAssistantSettings(admin, g.companyId)
  if (!settings.enabled) return NextResponse.json({ error: 'The Hub Assistant is switched off (Assistant tab).' }, { status: 409 })
  const { data: me } = await admin.from('hub_users').select('display_name').eq('id', g.userId).maybeSingle()
  const myName = (me as { display_name?: string | null } | null)?.display_name?.trim()
  if (!myName) return NextResponse.json({ error: 'Your Hub profile has no name.' }, { status: 409 })

  const out = await runHubAction(
    { admin, actor, turnId: `amber-test:${crypto.randomUUID()}`, amber: { source: 'test' } },
    settings,
    'post_hub_message',
    {
      teammate_name: myName,
      message: "Test from Amber's approval queue. If you're reading this, approving works.",
      reason: "A test item added from Admin → AI → Amber's account.",
    },
  )
  return NextResponse.json({
    result: out.startsWith('QUEUED')
      ? 'Added. Open Amber in the Hub sidebar (under My Tasks) to approve it. Approvers were sent a notification.'
      : out,
  })
}
