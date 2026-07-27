import { NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCompany } from '@/lib/company-auth'
import { getInboxUserFlags } from '@/lib/inbox/permissions'

export const dynamic = 'force-dynamic'

// POST /api/hub/email/threads/bulk — apply ONE action to MANY shared threads at once
// (manager triage). Mirrors the single-thread routes' column writes + inbox_thread_events
// inserts exactly (assign / close / reopen / tags / snooze / waiting).
//
// The WHOLE endpoint is gated on manager access: bulk triage is a manager activity, and a
// blanket gate avoids per-thread permission round-trips. Company isolation is enforced twice —
// every thread loaded is checked against the caller's company_id before it is ever touched, so
// a bogus id from another tenant is silently dropped (never acted on), never 500s the batch.
//
// Body: { thread_ids: string[], action, params? }. thread_ids is capped at 200 (extra truncated).

const ACTIONS = ['assign', 'close', 'reopen', 'add_tag', 'remove_tag', 'snooze', 'waiting'] as const
type Action = (typeof ACTIONS)[number]

// Waiting values (mirrors threads/[id]/waiting).
const WAITING_STATES = ['customer', 'tech', 'vendor', 'approval'] as const
type WaitingState = (typeof WAITING_STATES)[number]

const MAX_THREADS = 200

type ThreadRow = {
  id: string
  company_id: string
  tags: string[] | null
  assigned_to_user_id: string | null
  status: string
}

// Params resolved + validated once up front (they're identical across every thread, so
// there's no reason to re-validate per row). A validation failure here is a 400 for the
// whole request; a per-thread write failure inside the loop is skipped, not fatal.
type ResolvedParams =
  | { action: 'assign'; targetUserId: string | null }
  | { action: 'close' }
  | { action: 'reopen' }
  | { action: 'add_tag'; tagId: string }
  | { action: 'remove_tag'; tagId: string }
  | { action: 'snooze'; snoozedUntil: string | null }
  | { action: 'waiting'; waiting: WaitingState | null }

export async function POST(request: Request) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId, companyId } = auth

  const admin = createAdminClient()

  // Manager gate — the entire endpoint (bulk triage is manager-only).
  const flags = await getInboxUserFlags(admin, userId)
  if (!flags.isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as
    | { thread_ids?: unknown; action?: unknown; params?: unknown }
    | null

  // Validate thread_ids: non-empty string array, cap at MAX_THREADS (truncate the rest).
  const rawIds = Array.isArray(body?.thread_ids) ? body!.thread_ids : null
  if (!rawIds || rawIds.length === 0) {
    return NextResponse.json({ error: 'thread_ids must be a non-empty array' }, { status: 400 })
  }
  const threadIds = [...new Set(rawIds.filter((x): x is string => typeof x === 'string' && x.length > 0))].slice(
    0,
    MAX_THREADS
  )
  if (threadIds.length === 0) {
    return NextResponse.json({ error: 'thread_ids must contain at least one id' }, { status: 400 })
  }

  const action = body?.action
  if (typeof action !== 'string' || !ACTIONS.includes(action as Action)) {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }

  const params = (body?.params && typeof body.params === 'object' ? (body.params as Record<string, unknown>) : {}) as
    Record<string, unknown>

  // Resolve + validate params once (returns a 400 response, or the typed plan to run per thread).
  const resolved = await resolveParams(admin, action as Action, params, companyId)
  if ('error' in resolved) return resolved.error
  const plan = resolved.plan

  // Load target threads (admin client bypasses RLS) — then HARD company-isolation guard: keep only
  // rows in the caller's company. deleted_at IS NULL is filtered at the DB level.
  const { data: loaded, error: loadErr } = await admin
    .from('inbox_threads')
    .select('id, company_id, tags, assigned_to_user_id, status')
    .in('id', threadIds)
    .is('deleted_at', null)
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 })

  const threads = ((loaded ?? []) as ThreadRow[]).filter((t) => t.company_id === companyId)

  const nowIso = new Date().toISOString()
  let applied = 0

  // Best-effort per thread: one failure must not abort the rest.
  for (const thread of threads) {
    try {
      await applyAction(admin, plan, thread, userId, companyId, nowIso)
      applied += 1
    } catch (err) {
      console.warn('[inbox:bulk] thread failed', thread.id, err)
    }
  }

  // Anything requested but not applied (wrong company, deleted, missing, or a write error) is skipped.
  const skipped = threadIds.length - applied

  // One company-wide broadcast is enough for bulk — every open client refreshes.
  after(async () => {
    try {
      const ch = admin.channel('inbox:' + companyId)
      await ch.subscribe()
      await ch.send({ type: 'broadcast', event: 'update', payload: {} })
      await admin.removeChannel(ch)
    } catch (err) {
      console.warn('[inbox:bulk] broadcast failed', err)
    }
  })

  return NextResponse.json({ ok: true, applied, skipped })
}

// ---------------------------------------------------------------------------

async function resolveParams(
  admin: ReturnType<typeof createAdminClient>,
  action: Action,
  params: Record<string, unknown>,
  companyId: string
): Promise<{ plan: ResolvedParams } | { error: NextResponse }> {
  switch (action) {
    case 'assign': {
      // undefined/null/'' → unassign (matches threads/[id]/assign).
      const raw = params.user_id
      const targetUserId: string | null = raw === null ? null : (typeof raw === 'string' && raw ? raw : null)
      // Never assign to a user outside the caller's company (all surviving threads are this company).
      if (targetUserId) {
        const { data: target } = await admin
          .from('user_profiles')
          .select('company_id')
          .eq('id', targetUserId)
          .maybeSingle()
        if (!target || target.company_id !== companyId) {
          return { error: NextResponse.json({ error: 'Invalid user' }, { status: 400 }) }
        }
      }
      return { plan: { action: 'assign', targetUserId } }
    }
    case 'close':
      return { plan: { action: 'close' } }
    case 'reopen':
      return { plan: { action: 'reopen' } }
    case 'add_tag':
    case 'remove_tag': {
      const tagId = typeof params.tag_id === 'string' ? params.tag_id.trim() : ''
      if (!tagId) return { error: NextResponse.json({ error: 'tag_id is required' }, { status: 400 }) }
      // For add, the tag must exist, be in this company, and be active. (Remove allows dropping a
      // now-inactive tag, so it isn't re-verified — mirrors threads/[id]/tags DELETE.)
      if (action === 'add_tag') {
        const { data: tag } = await admin
          .from('inbox_tags')
          .select('id, company_id, active')
          .eq('id', tagId)
          .maybeSingle()
        if (!tag || tag.company_id !== companyId || tag.active !== true) {
          return { error: NextResponse.json({ error: 'Invalid tag' }, { status: 400 }) }
        }
      }
      return { plan: { action, tagId } }
    }
    case 'snooze': {
      const raw = params.snoozed_until ?? null
      let snoozedUntil: string | null = null
      if (raw !== null) {
        const ms = Date.parse(String(raw))
        if (Number.isNaN(ms)) return { error: NextResponse.json({ error: 'invalid snoozed_until' }, { status: 400 }) }
        snoozedUntil = new Date(ms).toISOString()
      }
      return { plan: { action: 'snooze', snoozedUntil } }
    }
    case 'waiting': {
      const raw = params.waiting_state ?? null
      const waiting: WaitingState | null = raw === null ? null : (String(raw) as WaitingState)
      if (waiting !== null && !WAITING_STATES.includes(waiting)) {
        return { error: NextResponse.json({ error: 'invalid waiting_state' }, { status: 400 }) }
      }
      return { plan: { action: 'waiting', waiting } }
    }
  }
}

// Apply the resolved plan to ONE thread. Mirrors the single-thread routes' writes exactly,
// including the same inbox_thread_events row (actor_user_id = userId). Throws on a hard error
// so the caller can count it as skipped.
async function applyAction(
  admin: ReturnType<typeof createAdminClient>,
  plan: ResolvedParams,
  thread: ThreadRow,
  userId: string,
  companyId: string,
  nowIso: string
): Promise<void> {
  const id = thread.id

  switch (plan.action) {
    case 'assign': {
      const targetUserId = plan.targetUserId
      // Owner is single-seat: drop the prior owner row, then seat the new owner (like assign route).
      await admin.from('inbox_thread_members').delete().eq('thread_id', id).eq('role', 'owner')
      if (targetUserId) {
        await admin.from('inbox_thread_members').delete().eq('thread_id', id).eq('user_id', targetUserId)
        const { error: memberErr } = await admin
          .from('inbox_thread_members')
          .insert({ thread_id: id, user_id: targetUserId, role: 'owner', added_by: userId })
        if (memberErr) throw new Error(memberErr.message)
      }
      const { error } = await admin
        .from('inbox_threads')
        .update({
          assigned_to_user_id: targetUserId,
          status: targetUserId ? 'assigned' : 'open',
          updated_at: nowIso,
        })
        .eq('id', id)
      if (error) throw new Error(error.message)
      const selfClaim = targetUserId === userId
      await admin.from('inbox_thread_events').insert({
        company_id: companyId,
        thread_id: id,
        event_type: selfClaim ? 'claimed' : 'assigned',
        actor_user_id: userId,
        target_user_id: targetUserId,
      })
      return
    }
    case 'close': {
      const { error } = await admin
        .from('inbox_threads')
        .update({ status: 'closed', closed_by_user_id: userId, updated_at: nowIso })
        .eq('id', id)
      if (error) throw new Error(error.message)
      await admin.from('inbox_thread_events').insert({
        company_id: companyId,
        thread_id: id,
        event_type: 'closed',
        actor_user_id: userId,
      })
      return
    }
    case 'reopen': {
      const { error } = await admin
        .from('inbox_threads')
        .update({ status: thread.assigned_to_user_id ? 'assigned' : 'open', updated_at: nowIso })
        .eq('id', id)
      if (error) throw new Error(error.message)
      await admin.from('inbox_thread_events').insert({
        company_id: companyId,
        thread_id: id,
        event_type: 'reopened',
        actor_user_id: userId,
      })
      return
    }
    case 'add_tag': {
      const current = thread.tags ?? []
      if (current.includes(plan.tagId)) return // idempotent no-op
      const { error } = await admin
        .from('inbox_threads')
        .update({ tags: [...current, plan.tagId], updated_at: nowIso })
        .eq('id', id)
      if (error) throw new Error(error.message)
      await admin.from('inbox_thread_events').insert({
        company_id: companyId,
        thread_id: id,
        event_type: 'tag_added',
        actor_user_id: userId,
        detail: { tag_id: plan.tagId },
      })
      return
    }
    case 'remove_tag': {
      const current = thread.tags ?? []
      if (!current.includes(plan.tagId)) return // idempotent no-op
      const { error } = await admin
        .from('inbox_threads')
        .update({ tags: current.filter((t) => t !== plan.tagId), updated_at: nowIso })
        .eq('id', id)
      if (error) throw new Error(error.message)
      await admin.from('inbox_thread_events').insert({
        company_id: companyId,
        thread_id: id,
        event_type: 'tag_removed',
        actor_user_id: userId,
        detail: { tag_id: plan.tagId },
      })
      return
    }
    case 'snooze': {
      const { error } = await admin
        .from('inbox_threads')
        .update({
          snoozed_until: plan.snoozedUntil,
          snoozed_by: plan.snoozedUntil ? userId : null,
          updated_at: nowIso,
        })
        .eq('id', id)
      if (error) throw new Error(error.message)
      await admin.from('inbox_thread_events').insert({
        company_id: companyId,
        thread_id: id,
        event_type: plan.snoozedUntil ? 'snoozed' : 'unsnoozed',
        actor_user_id: userId,
        detail: { snoozed_until: plan.snoozedUntil },
      })
      return
    }
    case 'waiting': {
      const waiting = plan.waiting
      const { error } = await admin
        .from('inbox_threads')
        .update({
          waiting_state: waiting,
          waiting_set_at: waiting ? nowIso : null,
          waiting_set_by: waiting ? userId : null,
          updated_at: nowIso,
        })
        .eq('id', id)
      if (error) throw new Error(error.message)
      await admin.from('inbox_thread_events').insert({
        company_id: companyId,
        thread_id: id,
        event_type: waiting ? 'waiting_set' : 'waiting_cleared',
        actor_user_id: userId,
        detail: waiting ? { waiting_state: waiting } : {},
      })
      return
    }
  }
}
