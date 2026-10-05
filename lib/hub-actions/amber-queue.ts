// Amber's approval queue — reading it and deciding items.
//
// Lives apart from ./amber.ts because deciding runs the action, which needs the
// catalog, and the catalog imports ./amber.ts (a cycle otherwise).
//
// The only way a pending item runs is decideAmberQueueItem, called from an
// approver's own Hub request. Amber has no session, so she cannot reach it.

import { clip } from './format'
import type { Admin } from './types'
import { getAssistantSettings } from './settings'
import { buildAmberPreview, runApprovedAmberAction } from './catalog'
import { amberActingAction, isAmberApprover, resolveAmberActor } from './amber'

export type AmberQueueRow = {
  id: string
  action: string
  args: Record<string, unknown>
  preview: string
  reason: string
  source: string
  status: string
  edited: boolean
  result: string | null
  decided_by: string | null
  decided_at: string | null
  reject_note: string | null
  expires_at: string | null
  created_at: string
}

export const AMBER_QUEUE_COLUMNS =
  'id, action, args, preview, reason, source, status, edited, result, decided_by, decided_at, reject_note, expires_at, created_at'

/** Mark this company's overdue pending items expired (lazy — run on read). */
export async function expireStaleAmberItems(admin: Admin, companyId: string): Promise<void> {
  await admin
    .from('amber_queue')
    .update({ status: 'expired' })
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
}

export type AmberDecision =
  | { decision: 'reject'; note?: string }
  | { decision: 'approve'; edits?: Record<string, unknown>; seenPreview: string }

export type DecideResult = { ok: true; item: AmberQueueRow } | { ok: false; status: number; error: string }

export async function decideAmberQueueItem(
  admin: Admin,
  companyId: string,
  deciderId: string,
  itemId: string,
  d: AmberDecision,
): Promise<DecideResult> {
  if (!(await isAmberApprover(admin, companyId, deciderId))) {
    return { ok: false, status: 403, error: "You aren't one of Amber's approvers. An admin can add you in Admin → AI → Amber's account." }
  }

  const { data } = await admin
    .from('amber_queue')
    .select(AMBER_QUEUE_COLUMNS)
    .eq('id', itemId)
    .eq('company_id', companyId)
    .maybeSingle()
  const item = data as AmberQueueRow | null
  if (!item) return { ok: false, status: 404, error: 'That item no longer exists.' }
  if (item.status !== 'pending') return { ok: false, status: 409, error: `Already ${item.status}.` }
  if (item.expires_at && Date.parse(item.expires_at) < Date.now()) {
    await admin.from('amber_queue').update({ status: 'expired' }).eq('id', item.id).eq('status', 'pending')
    return { ok: false, status: 409, error: 'That expired before anyone decided. Nothing was done.' }
  }

  const now = new Date().toISOString()

  if (d.decision === 'reject') {
    const { data: claimed, error } = await admin
      .from('amber_queue')
      .update({
        status: 'rejected',
        decided_by: deciderId,
        decided_at: now,
        reject_note: d.note ? clip(d.note.trim(), 500) : null,
      })
      .eq('id', item.id)
      .eq('status', 'pending')
      .select(AMBER_QUEUE_COLUMNS)
      .maybeSingle()
    if (error) return { ok: false, status: 500, error: "Couldn't save that just now. Nothing was done." }
    if (!claimed) return { ok: false, status: 409, error: 'Someone else just decided this one.' }
    return { ok: true, item: claimed as AmberQueueRow }
  }

  const actor = await resolveAmberActor(admin, companyId)
  if (!actor) return { ok: false, status: 409, error: "This company has no Amber account in the Hub, so it can't run." }
  const settings = await getAssistantSettings(admin, companyId)
  if (!settings.enabled) return { ok: false, status: 409, error: 'The Hub Assistant is switched off for this company.' }
  const ctx = { admin, actor, turnId: `amber-queue:${item.id}` }

  // Re-check EXACTLY what will happen, on every approval. An item can wait up to
  // 3 days: a customer may have opted out or changed number, a room may have been
  // renamed. Built from the ORIGINAL arguments first, so an edit can't skip it.
  const original = await buildAmberPreview(ctx, item.action, item.args ?? {})
  if (!original.ok) return { ok: false, status: 409, error: original.message }
  if (original.preview !== item.preview) {
    const { error: saveErr } = await admin
      .from('amber_queue')
      .update({ preview: original.preview })
      .eq('id', item.id)
      .eq('status', 'pending')
    if (saveErr) return { ok: false, status: 500, error: "Couldn't refresh that card just now. Nothing was done." }
    return { ok: false, status: 409, error: 'Something changed since Amber queued this. Check the updated card, then approve again.' }
  }
  // …and the approver must have been LOOKING at that card. Without this, a card
  // refreshed on the server but not yet on their screen could be approved unseen.
  if (d.seenPreview !== item.preview) {
    return { ok: false, status: 409, error: 'This card was updated. Check it again, then approve.' }
  }

  // Edits: only the free-text fields the action allows, so an edit can reword a
  // message but never change who it goes to.
  let args = item.args ?? {}
  let edited = false
  if (d.edits && Object.keys(d.edits).length) {
    const allowed = amberActingAction(item.action)?.editable ?? []
    const next = { ...args }
    for (const [k, v] of Object.entries(d.edits)) {
      if (!allowed.includes(k)) return { ok: false, status: 400, error: `"${k}" can't be edited.` }
      if (typeof v !== 'string' || !v.trim()) return { ok: false, status: 400, error: `"${k}" can't be empty.` }
      if (next[k] !== v.trim()) {
        next[k] = v.trim()
        edited = true
      }
    }
    args = next
  }

  // An edit re-validates the reworded version (length, opt-out) and becomes the
  // stored preview.
  let preview = item.preview
  if (edited) {
    const built = await buildAmberPreview(ctx, item.action, args)
    if (!built.ok) return { ok: false, status: 400, error: built.message }
    preview = built.preview
  }

  // Claim first (compare-and-set into 'running'), so two approvers tapping at
  // once can't both run it — and a crash mid-run is visible as stuck 'running',
  // never mistaken for a success.
  const { data: claimed, error: claimErr } = await admin
    .from('amber_queue')
    .update({ status: 'running', decided_by: deciderId, decided_at: now, args, preview, edited })
    .eq('id', item.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (claimErr) return { ok: false, status: 500, error: "Couldn't save that just now. Nothing was done." }
  if (!claimed) return { ok: false, status: 409, error: 'Someone else just decided this one.' }

  const out = await runApprovedAmberAction(ctx, settings, item.action, args)
  const finalStatus = out.ran ? 'approved' : 'failed'
  const { data: done, error: doneErr } = await admin
    .from('amber_queue')
    .update({ status: finalStatus, result: clip(out.result, 2000) })
    .eq('id', item.id)
    .select(AMBER_QUEUE_COLUMNS)
    .maybeSingle()
  if (doneErr) console.warn('[amber-queue] result not saved for', item.id, doneErr.message)
  return { ok: true, item: (done as AmberQueueRow | null) ?? { ...item, status: finalStatus, result: out.result } }
}

export type AmberActionStats = { approved: number; edited: number; rejected: number; auto: number; failed: number }

/** Per-action track record over the last `days` days — what an admin looks at
 *  before switching an action to automatic. */
export async function amberActionStats(
  admin: Admin,
  companyId: string,
  days = 90,
): Promise<Record<string, AmberActionStats>> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await admin
    .from('amber_queue')
    .select('action, status, edited')
    .eq('company_id', companyId)
    .gte('created_at', since)
    .in('status', ['approved', 'rejected', 'auto', 'failed'])
    .limit(5000)
  const out: Record<string, AmberActionStats> = {}
  for (const r of (data || []) as Array<{ action: string; status: string; edited: boolean }>) {
    const s = (out[r.action] ??= { approved: 0, edited: 0, rejected: 0, auto: 0, failed: 0 })
    if (r.status === 'approved') {
      s.approved++
      if (r.edited) s.edited++
    } else if (r.status === 'rejected') s.rejected++
    else if (r.status === 'auto') s.auto++
    else if (r.status === 'failed') s.failed++
  }
  return out
}
