import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import {
  GARY_SERVICES,
  GARY_SERVICE_LABEL,
  GARY_SIGNATURE,
  getGaryBot,
  getGarySettings,
  isGaryApprover,
  saveGarySettings,
} from '@/lib/gary'
import { WINBACK_SKIP_LABEL, buildWinbackPreview } from '@/lib/gary-winback'
import { GARY_QUEUE_COLUMNS, expireStaleGaryEmails, garySentToday } from '@/lib/gary-email'

// Admin → AI → Gary's account. Session 1: identity, settings, the preview list.
// Session 2: the emails Gary writes, waiting for an approver, and what was sent.

export const dynamic = 'force-dynamic'

type Admin = ReturnType<typeof createAdminClient>

async function guard() {
  const auth = await requireAdminArea('ai')
  if (!auth.ok || !auth.company_id || !auth.user) return null
  return { companyId: auth.company_id, userId: auth.user.id }
}

/** People who may be picked as approvers: active admins + AI admins (the only
 *  people who can open this page to approve). */
async function approverChoices(admin: Admin, companyId: string): Promise<{ id: string; name: string }[]> {
  const [{ data: profiles }, { data: hubUsers }] = await Promise.all([
    admin.from('user_profiles').select('id, role, can_admin_ai, locked_at, deactivated_at').eq('company_id', companyId),
    admin.from('hub_users').select('id, display_name, is_bot').eq('company_id', companyId),
  ])
  const names = new Map(
    ((hubUsers || []) as { id: string; display_name: string | null; is_bot: boolean | null }[])
      .filter((u) => !u.is_bot)
      .map((u) => [u.id, u.display_name || '(no name)']),
  )
  return ((profiles || []) as { id: string; role: string | null; can_admin_ai: boolean | null; locked_at: string | null; deactivated_at: string | null }[])
    .filter((p) => names.has(p.id) && !p.locked_at && !p.deactivated_at && (p.role === 'admin' || p.can_admin_ai === true))
    .map((p) => ({ id: p.id, name: names.get(p.id) as string }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function GET() {
  const g = await guard()
  if (!g) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient()

  try {
    await expireStaleGaryEmails(admin, g.companyId)
    const settings = await getGarySettings(admin, g.companyId)
    const [bot, preview, people, isApprover, sentToday, { data: pending }, { data: recent }] = await Promise.all([
      getGaryBot(admin, g.companyId, settings.botUserId),
      buildWinbackPreview(admin, g.companyId, settings),
      approverChoices(admin, g.companyId),
      isGaryApprover(admin, g.companyId, g.userId, settings),
      garySentToday(admin, g.companyId),
      admin.from('gary_queue').select(GARY_QUEUE_COLUMNS).eq('company_id', g.companyId).eq('status', 'pending').order('created_at', { ascending: true }).limit(50),
      admin.from('gary_queue').select(GARY_QUEUE_COLUMNS).eq('company_id', g.companyId).neq('status', 'pending').order('created_at', { ascending: false }).limit(25),
    ])
    const nameById = new Map(people.map((p) => [p.id, p.name]))
    const withDecider = (rows: unknown) =>
      ((rows || []) as { decided_by: string | null }[]).map((r) => ({ ...r, decided_by_name: r.decided_by ? nameById.get(r.decided_by) ?? null : null }))

    return NextResponse.json({
      bot: bot ? { id: bot.id, name: bot.displayName, hasAvatar: Boolean(bot.avatarUrl) } : null,
      signature: GARY_SIGNATURE,
      settings: {
        services: settings.services,
        recentTouchDays: settings.recentTouchDays,
        approverIds: settings.approverIds,
        dailyEmailCap: settings.dailyEmailCap,
      },
      serviceChoices: GARY_SERVICES.map((s) => ({ key: s, label: GARY_SERVICE_LABEL[s] })),
      skipLabels: WINBACK_SKIP_LABEL,
      people,
      isApprover,
      sentToday,
      pending: withDecider(pending),
      recent: withDecider(recent),
      preview,
    })
  } catch (e) {
    console.error('[gary-account] GET failed', e)
    return NextResponse.json({ error: "Couldn't build Gary's list. Try again in a minute." }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const g = await guard()
  if (!g) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as {
    services?: unknown
    recentTouchDays?: unknown
    approverIds?: unknown
    dailyEmailCap?: unknown
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const admin = createAdminClient()
  try {
    let approverIds: string[] | undefined
    if (body.approverIds !== undefined) {
      if (!Array.isArray(body.approverIds)) return NextResponse.json({ error: 'approverIds must be a list' }, { status: 400 })
      const allowed = new Set((await approverChoices(admin, g.companyId)).map((p) => p.id))
      approverIds = [...new Set(body.approverIds.filter((x): x is string => typeof x === 'string' && allowed.has(x)))]
    }
    await saveGarySettings(admin, g.companyId, g.userId, {
      services: body.services,
      recentTouchDays: body.recentTouchDays,
      approverIds,
      dailyEmailCap: body.dailyEmailCap,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't save that." }, { status: 400 })
  }
}
