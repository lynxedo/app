// Work Orders Phase 2 — a stop's line items, and getting them onto the Jobber
// VISIT before the visit is completed. PRD §6 Phase 2.
//
// The one rule that shapes everything here: most recurring customers are on
// autopay, and Jobber invoices + charges them within about a minute of
// visitComplete, from the VISIT's line items. So `completeStopInJobber` sends
// every changed item first and calls visitComplete only when all of them have
// landed. A failed item leaves the visit open in Jobber (no charge) and the
// stop flagged for the office; the retry cron finishes it.
//
// How Jobber behaves (verified on test jobs #2694/#2695, Oct 2 2026):
//  • A visit that was never edited shows the JOB's shared line items (same ids).
//    visitEditLineItems on one of them FORKS a visit-only copy with a new id;
//    visitCreateLineItems adds a visit-only item. Other visits stay untouched.
//  • Both come back taxable=true and unlinked from the catalog, whatever we send
//    — so each is followed by jobEditLineItems on the NEW id (taxable +
//    productOrServiceId), which changes only that one visit.
//  • Jobber also lists those visit-only items on the job; jobber-sync skips them
//    (visitOnlyLineItemIds) so job-level reports don't double-count.
//  • Nothing is ever deleted from Jobber (PRD rule 4): "not done" = quantity 0.

import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { jobberGraphQLPatient, companyJobberUserId } from '@/lib/jobber'
import { refreshVisitsByExternalIds } from '@/lib/jobber-sync'

type Admin = ReturnType<typeof createAdminClient>

export type WorkOrderLineItem = {
  id: string
  company_id: string
  stop_id: string
  source: 'jobber' | 'tech_added' | 'inspection_suggested'
  status: 'proposed' | 'accepted' | 'dismissed'
  name: string
  description: string | null
  quantity: number
  unit_price: number
  taxable: boolean | null
  orig_quantity: number | null
  orig_unit_price: number | null
  jobber_line_item_id: string | null
  replaced_jobber_line_item_id: string | null
  jobber_product_id: string | null
  visit_only: boolean
  sync_state: 'synced' | 'pending' | 'error'
  sync_error: string | null
  sync_attempts: number
  synced_at: string | null
  suggestion_rule_id: string | null
  suggestion_note: string | null
  added_by: string | null
  edited_by: string | null
  edited_at: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type LineItemStop = {
  id: string
  status: string
  jobber_visit_id: string | null
  jobber_job_id: string | null
  line_items: unknown
}

/** After this many failed pushes an item stops retrying and waits for the office. */
export const MAX_SYNC_ATTEMPTS = 8

const ITEM_COLS =
  'id, company_id, stop_id, source, status, name, description, quantity, unit_price, taxable, orig_quantity, orig_unit_price, ' +
  'jobber_line_item_id, replaced_jobber_line_item_id, jobber_product_id, visit_only, sync_state, sync_error, sync_attempts, synced_at, ' +
  'suggestion_rule_id, suggestion_note, added_by, edited_by, edited_at, sort_order, created_at, updated_at'

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const money = (n: number) => Math.round(n * 100) / 100
const sameMoney = (a: unknown, b: unknown) => Math.abs(num(a) - num(b)) < 0.005

function normalize(r: Record<string, unknown>): WorkOrderLineItem {
  const row = r as unknown as WorkOrderLineItem
  return {
    ...row,
    quantity: num(row.quantity),
    unit_price: num(row.unit_price),
    orig_quantity: row.orig_quantity == null ? null : num(row.orig_quantity),
    orig_unit_price: row.orig_unit_price == null ? null : num(row.orig_unit_price),
  }
}

/** A Jobber-origin row the tech changed (quantity or price differs from Jobber's). */
export function isEditedByTech(li: Pick<WorkOrderLineItem, 'source' | 'quantity' | 'unit_price' | 'orig_quantity' | 'orig_unit_price'>): boolean {
  if (li.source !== 'jobber' || li.orig_quantity == null || li.orig_unit_price == null) return false
  return !sameMoney(li.quantity, li.orig_quantity) || !sameMoney(li.unit_price, li.orig_unit_price)
}

// ── Load (seed + follow the office's Jobber edits) ───────────────────────────

type MirrorItem = {
  external_id: string
  name: string
  description: string | null
  quantity: number
  unit_price: number
  last_synced_at: string | null
}

async function readMirrorVisitItems(admin: Admin, companyId: string, visitId: string): Promise<MirrorItem[]> {
  const { data } = await admin
    .from('line_items')
    .select('external_id, name, description, quantity, unit_price, last_synced_at, created_at')
    .eq('company_id', companyId).eq('source', 'jobber').eq('parent_type', 'visit')
    .eq('parent_external_id', visitId).is('deleted_at', null)
    .order('created_at', { ascending: true })
  return (data ?? []).map(r => ({
    external_id: r.external_id as string,
    name: (r.name as string) ?? '',
    description: (r.description as string | null) ?? null,
    quantity: num(r.quantity),
    unit_price: num(r.unit_price),
    last_synced_at: (r.last_synced_at as string | null) ?? null,
  }))
}

async function readRows(admin: Admin, stopId: string): Promise<WorkOrderLineItem[]> {
  const { data } = await admin
    .from('work_order_line_items').select(ITEM_COLS)
    .eq('stop_id', stopId).is('deleted_at', null)
    .order('sort_order', { ascending: true }).order('created_at', { ascending: true })
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(normalize)
}

/**
 * The stop's line items, seeded on first read and kept in step with Jobber.
 *
 * First read: one `jobber` row per item on the mirrored Jobber visit (or, for a
 * stop without a mirrored visit, the jsonb snapshot the route was sent with).
 * Later reads follow the office's own Jobber edits — an item added in Jobber
 * appears, a price changed in Jobber updates — but ONLY on Jobber-origin rows
 * nobody in Hub has touched (never edited, never pushed by Hub). Once a tech
 * changes or adds an item, Hub is the authority for it: the mirror is re-read
 * from Jobber moments after our own push and can come back with the value from
 * BEFORE the push (seen Oct 5 2026: a tech's $25 was pushed, then a stale $125
 * mirror read overwrote the Hub row). An item the office removed in Jobber
 * disappears (same untouched-only rule); an empty mirror never deletes anything.
 */
export async function loadStopLineItems(admin: Admin, companyId: string, stop: LineItemStop): Promise<WorkOrderLineItem[]> {
  const rows = await readRows(admin, stop.id)
  const mirror = stop.jobber_visit_id ? await readMirrorVisitItems(admin, companyId, stop.jobber_visit_id) : []
  const nowIso = new Date().toISOString()

  if (rows.length === 0) {
    let seed: Array<Record<string, unknown>> = []
    if (mirror.length > 0) {
      seed = mirror.map((m, i) => ({
        company_id: companyId, stop_id: stop.id, source: 'jobber', status: 'accepted',
        name: m.name, description: m.description, quantity: m.quantity, unit_price: m.unit_price,
        orig_quantity: m.quantity, orig_unit_price: m.unit_price,
        jobber_line_item_id: m.external_id, sync_state: 'synced', synced_at: nowIso, sort_order: i,
      }))
    } else if (Array.isArray(stop.line_items)) {
      seed = (stop.line_items as Array<{ name?: string; qty?: number; unitPrice?: number }>)
        .filter(li => li?.name)
        .map((li, i) => ({
          company_id: companyId, stop_id: stop.id, source: 'jobber', status: 'accepted',
          name: li.name, quantity: num(li.qty ?? 1), unit_price: num(li.unitPrice),
          orig_quantity: num(li.qty ?? 1), orig_unit_price: num(li.unitPrice),
          sync_state: 'synced', synced_at: nowIso, sort_order: i,
        }))
    }
    if (seed.length === 0) return []
    // Two tabs opening the same stop at once could both seed — re-check first.
    const again = await readRows(admin, stop.id)
    if (again.length > 0) return again
    await admin.from('work_order_line_items').insert(seed)
    return readRows(admin, stop.id)
  }

  if (mirror.length === 0) return rows

  const mirrorAt = mirror.reduce((max, m) => (m.last_synced_at && m.last_synced_at > max ? m.last_synced_at : max), '')
  const byId = new Map(rows.filter(r => r.jobber_line_item_id).map(r => [r.jobber_line_item_id as string, r]))
  const replaced = new Set(rows.map(r => r.replaced_jobber_line_item_id).filter((x): x is string => !!x))
  const mirrorIds = new Set(mirror.map(m => m.external_id))
  let changed = false

  for (const m of mirror) {
    if (replaced.has(m.external_id)) continue // the shared item we forked away from
    const row = byId.get(m.external_id)
    if (row) {
      const lastOurs = row.synced_at ?? row.updated_at
      if (!untouched(row) || !mirrorAt || mirrorAt <= lastOurs) continue
      if (row.name !== m.name || !sameMoney(row.quantity, m.quantity) || !sameMoney(row.unit_price, m.unit_price)) {
        await admin.from('work_order_line_items').update({
          name: m.name, description: m.description, quantity: m.quantity, unit_price: m.unit_price,
          orig_quantity: m.quantity, orig_unit_price: m.unit_price, synced_at: nowIso, updated_at: nowIso,
        }).eq('id', row.id)
        changed = true
      }
      continue
    }
    // A row seeded from the jsonb snapshot has no id yet — adopt by name.
    const unlinked = rows.find(r => !r.jobber_line_item_id && r.source === 'jobber' && r.name === m.name)
    if (unlinked) {
      await admin.from('work_order_line_items').update({ jobber_line_item_id: m.external_id, updated_at: nowIso }).eq('id', unlinked.id)
      unlinked.jobber_line_item_id = m.external_id
      changed = true
      continue
    }
    // New in Jobber (the office added it) — unless the mirror is older than a push.
    const newestPush = rows.reduce((max, r) => (r.synced_at && r.synced_at > max ? r.synced_at : max), '')
    if (newestPush && mirrorAt <= newestPush) continue
    await admin.from('work_order_line_items').insert({
      company_id: companyId, stop_id: stop.id, source: 'jobber', status: 'accepted',
      name: m.name, description: m.description, quantity: m.quantity, unit_price: m.unit_price,
      orig_quantity: m.quantity, orig_unit_price: m.unit_price,
      jobber_line_item_id: m.external_id, sync_state: 'synced', synced_at: nowIso,
      sort_order: rows.length,
    })
    changed = true
  }

  // Removed in Jobber by the office: only untouched Jobber-origin rows, and only
  // when the mirror is newer than the row (a fresh push may not be mirrored yet).
  for (const r of rows) {
    if (!untouched(r) || !r.jobber_line_item_id) continue
    if (mirrorIds.has(r.jobber_line_item_id)) continue
    if (!mirrorAt || mirrorAt <= (r.synced_at ?? r.updated_at)) continue
    await admin.from('work_order_line_items').update({ deleted_at: nowIso, updated_at: nowIso }).eq('id', r.id)
    changed = true
  }

  return changed ? readRows(admin, stop.id) : rows
}

/** A Jobber-origin row Hub never changed — the only kind the mirror may update or remove. */
function untouched(r: WorkOrderLineItem): boolean {
  return r.source === 'jobber' && !r.visit_only && !r.edited_at && !r.replaced_jobber_line_item_id && r.sync_state === 'synced'
}

/** Line items in the shape the pesticide matcher and route snapshot use. */
export function asStopLineItems(rows: WorkOrderLineItem[]): Array<{ name: string; qty: number; unitPrice: number; totalPrice: number }> {
  return rows
    .filter(r => r.status === 'accepted' && r.quantity > 0)
    .map(r => ({ name: r.name, qty: r.quantity, unitPrice: r.unit_price, totalPrice: money(r.quantity * r.unit_price) }))
}

// ── Push to Jobber ────────────────────────────────────────────────────────────

type LiveItem = {
  id: string
  name: string
  quantity: number
  unitPrice: number
  taxable: boolean | null
  linkedProductOrService: { id: string } | null
}

type LiveVisit = {
  id: string
  isComplete: boolean
  job: { id: string; willClientBeAutomaticallyCharged: boolean | null } | null
  lineItems: { nodes: LiveItem[] }
}

const VISIT_QUERY = `
  query WorkOrderVisit($id: EncodedId!) {
    visit(id: $id) {
      id isComplete
      job { id willClientBeAutomaticallyCharged }
      lineItems(first: 50) { nodes { id name quantity unitPrice taxable linkedProductOrService { id } } }
    }
  }
`

const VISIT_ITEMS_FRAGMENT = `visit { lineItems(first: 50) { nodes { id name quantity unitPrice taxable linkedProductOrService { id } } } }`

const VISIT_CREATE_ITEMS = `
  mutation WorkOrderVisitCreateItems($visitId: EncodedId!, $input: VisitCreateLineItemInput!) {
    visitCreateLineItems(visitId: $visitId, input: $input) { ${VISIT_ITEMS_FRAGMENT} userErrors { message path } }
  }
`

const VISIT_EDIT_ITEMS = `
  mutation WorkOrderVisitEditItems($visitId: EncodedId!, $input: VisitEditLineItemsInput!) {
    visitEditLineItems(visitId: $visitId, input: $input) { ${VISIT_ITEMS_FRAGMENT} userErrors { message path } }
  }
`

const JOB_EDIT_ITEMS = `
  mutation WorkOrderJobEditItems($jobId: EncodedId!, $input: JobEditLineItemsInput!) {
    jobEditLineItems(jobId: $jobId, input: $input) { userErrors { message path } }
  }
`

const VISIT_COMPLETE = `
  mutation WorkOrderVisitComplete($visitId: EncodedId!) {
    visitComplete(visitId: $visitId) { visit { id isComplete } userErrors { message path } }
  }
`

type UserErrors = Array<{ message: string }>
type ItemsPayload = { visit: { lineItems: { nodes: LiveItem[] } } | null; userErrors: UserErrors }

function errText(errors: UserErrors | undefined): string | null {
  return errors && errors.length ? errors.map(e => e.message).join('; ') : null
}

/** Take the stop's push lock; false when another push is running (≤ 3 min old). */
async function takeLock(admin: Admin, stopId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - 3 * 60 * 1000).toISOString()
  const { data } = await admin
    .from('daily_log_stops')
    .update({ jobber_sync_lock_at: new Date().toISOString() })
    .eq('id', stopId)
    .or(`jobber_sync_lock_at.is.null,jobber_sync_lock_at.lt."${staleBefore}"`)
    .select('id')
  return (data ?? []).length > 0
}

async function releaseLock(admin: Admin, stopId: string) {
  await admin.from('daily_log_stops').update({ jobber_sync_lock_at: null }).eq('id', stopId)
}

/**
 * After visitEdit/CreateLineItems: Jobber's new visit-only copy is taxable and
 * unlinked whatever we asked for. Put the tax flag and catalog link right on
 * that one item (a job-level edit of a visit-only item touches only its visit).
 */
async function fixVisitOnlyItem(jobberUserId: string, jobId: string, lineItemId: string, taxable: boolean | null, productId: string | null): Promise<string | null> {
  const attrs: Record<string, unknown> = { lineItemId }
  if (taxable != null) attrs.taxable = taxable
  if (productId) attrs.productOrServiceId = productId
  if (Object.keys(attrs).length === 1) return null
  const res = await jobberGraphQLPatient<{ data?: { jobEditLineItems?: { userErrors: UserErrors } } }>(
    jobberUserId, JOB_EDIT_ITEMS, { jobId, input: { lineItems: [attrs] } },
  )
  return errText(res.data?.jobEditLineItems?.userErrors)
}

type PushResult = { pushed: number; failed: number; live: LiveVisit | null; error: string | null }

/**
 * Send every accepted, unsynced line item of the stop to its Jobber visit.
 * Caller holds the lock. Each item is one mutation (so a failure is that
 * item's alone, and the new id is unambiguous); re-running only touches items
 * still unsynced, and an edit whose values Jobber already has is just marked
 * synced — so a retry never duplicates.
 */
async function pushItems(admin: Admin, jobberUserId: string, stop: LineItemStop, rows: WorkOrderLineItem[]): Promise<PushResult> {
  const visitId = stop.jobber_visit_id as string
  const res = await jobberGraphQLPatient<{ data?: { visit: LiveVisit | null } }>(jobberUserId, VISIT_QUERY, { id: visitId })
  const live = res.data?.visit ?? null
  if (!live) return { pushed: 0, failed: 0, live: null, error: 'The visit was not found in Jobber' }
  const jobId = live.job?.id ?? stop.jobber_job_id
  let current = live.lineItems.nodes
  let pushed = 0
  let failed = 0

  const todo = rows.filter(r => r.status === 'accepted' && r.sync_state !== 'synced' && r.sync_attempts < MAX_SYNC_ATTEMPTS)
  for (const row of todo) {
    const nowIso = new Date().toISOString()
    try {
      const qty = row.quantity
      const price = row.unit_price
      let itemId = row.jobber_line_item_id
      // A Jobber row seeded from the snapshot (no id) — find it on the live visit.
      if (!itemId && row.source === 'jobber') {
        const claimed = new Set(rows.map(r => r.jobber_line_item_id).filter(Boolean))
        itemId = current.find(li => li.name === row.name && !claimed.has(li.id))?.id ?? null
        if (!itemId) throw new Error('This item is no longer on the visit in Jobber')
      }

      const patch: Record<string, unknown> = { sync_state: 'synced', sync_error: null, synced_at: nowIso, updated_at: nowIso }

      if (!itemId) {
        // New item (tech-added or an accepted suggestion).
        if (qty === 0) {
          await admin.from('work_order_line_items').update(patch).eq('id', row.id)
          continue
        }
        if (!jobId) throw new Error('No Jobber job for this visit')
        const before = new Set(current.map(li => li.id))
        const out = await jobberGraphQLPatient<{ data?: { visitCreateLineItems?: ItemsPayload } }>(jobberUserId, VISIT_CREATE_ITEMS, {
          visitId,
          input: { lineItems: [{
            name: row.name, description: row.description ?? '', quantity: qty, unitPrice: price,
            totalPrice: money(qty * price), saveToProductsAndServices: false,
          }] },
        })
        const p = out.data?.visitCreateLineItems
        const ue = errText(p?.userErrors)
        if (ue) throw new Error(ue)
        const after = p?.visit?.lineItems.nodes ?? []
        const added = after.filter(li => !before.has(li.id))
        if (added.length !== 1) throw new Error('Jobber did not return the new line item')
        current = after
        const fixErr = await fixVisitOnlyItem(jobberUserId, jobId, added[0].id, row.taxable, row.jobber_product_id)
        Object.assign(patch, { jobber_line_item_id: added[0].id, visit_only: true })
        if (fixErr) Object.assign(patch, { sync_state: 'error', sync_error: `Added, but Jobber's tax/catalog fix failed: ${fixErr}`, sync_attempts: row.sync_attempts + 1 })
      } else {
        const liveItem = current.find(li => li.id === itemId)
        if (!liveItem) throw new Error('This item is no longer on the visit in Jobber')
        if (row.taxable == null && liveItem.taxable != null) patch.taxable = liveItem.taxable
        if (sameMoney(liveItem.quantity, qty) && sameMoney(liveItem.unitPrice, price)) {
          // Jobber already has these values (a retry after a lost response).
          patch.jobber_line_item_id = itemId
        } else {
          const before = new Set(current.map(li => li.id))
          const out = await jobberGraphQLPatient<{ data?: { visitEditLineItems?: ItemsPayload } }>(jobberUserId, VISIT_EDIT_ITEMS, {
            visitId,
            input: { lineItems: [{ lineItemId: itemId, quantity: qty, unitPrice: price, totalPrice: money(qty * price) }] },
          })
          const p = out.data?.visitEditLineItems
          const ue = errText(p?.userErrors)
          if (ue) throw new Error(ue)
          const after = p?.visit?.lineItems.nodes ?? []
          current = after
          if (after.some(li => li.id === itemId)) {
            patch.jobber_line_item_id = itemId // edited in place (already visit-only)
          } else {
            // Forked: Jobber gave this visit its own copy of the shared item.
            const added = after.filter(li => !before.has(li.id))
            if (added.length !== 1) throw new Error('Jobber did not return the changed line item')
            if (!jobId) throw new Error('No Jobber job for this visit')
            const fixErr = await fixVisitOnlyItem(jobberUserId, jobId, added[0].id, liveItem.taxable, liveItem.linkedProductOrService?.id ?? row.jobber_product_id)
            Object.assign(patch, { jobber_line_item_id: added[0].id, replaced_jobber_line_item_id: itemId, visit_only: true })
            if (fixErr) Object.assign(patch, { sync_state: 'error', sync_error: `Changed, but Jobber's tax/catalog fix failed: ${fixErr}`, sync_attempts: row.sync_attempts + 1 })
          }
        }
      }

      await admin.from('work_order_line_items').update(patch).eq('id', row.id)
      if (patch.sync_state === 'synced') pushed++
      else failed++
    } catch (e) {
      failed++
      await admin.from('work_order_line_items').update({
        sync_state: 'error',
        sync_error: e instanceof Error ? e.message : 'Jobber push failed',
        sync_attempts: row.sync_attempts + 1,
        updated_at: nowIso,
      }).eq('id', row.id)
    }
  }
  return { pushed, failed, live: { ...live, lineItems: { nodes: current } }, error: null }
}

export type CompleteInJobberResult = {
  jobberPushed: boolean          // the visit is complete in Jobber
  warning: string | null
  autopay: boolean | null
  itemsPushed: number
  itemsFailed: number
}

/**
 * Line items first, then visitComplete — never the other way round (autopay).
 * Marks the stop `jobber_complete_pending` until the visit really is complete
 * in Jobber, so the retry cron can finish what a failed attempt left.
 */
export async function completeStopInJobber(admin: Admin, companyId: string, stopId: string, actorUserId: string): Promise<CompleteInJobberResult> {
  const none: CompleteInJobberResult = { jobberPushed: false, warning: null, autopay: null, itemsPushed: 0, itemsFailed: 0 }
  const { data: stop } = await admin
    .from('daily_log_stops').select('id, status, jobber_visit_id, jobber_job_id, line_items')
    .eq('id', stopId).maybeSingle<LineItemStop>()
  if (!stop?.jobber_visit_id) return none

  await admin.from('daily_log_stops').update({ jobber_complete_pending: true }).eq('id', stopId)
  if (!(await takeLock(admin, stopId))) {
    return { ...none, warning: 'Already sending this stop to Jobber — it will finish on its own.' }
  }
  try {
    const jobberUserId = await companyJobberUserId(companyId, actorUserId)
    if (!jobberUserId) throw new Error('No connected Jobber account for this company')

    const rows = await loadStopLineItems(admin, companyId, stop)
    const push = await pushItems(admin, jobberUserId, stop, rows)
    if (push.error || !push.live) throw new Error(push.error ?? 'Jobber visit unavailable')
    const autopay = push.live.job?.willClientBeAutomaticallyCharged ?? null

    const after = await readRows(admin, stopId)
    const unsynced = after.filter(r => r.status === 'accepted' && r.sync_state !== 'synced')
    if (unsynced.length > 0) {
      const msg = `${unsynced.length} line item${unsynced.length === 1 ? ' is' : 's are'} not in Jobber yet — the visit stays open in Jobber until ${unsynced.length === 1 ? 'it lands' : 'they land'}` +
        (autopay ? ' (autopay: the card is not charged until then)' : '') + '. Retrying automatically.'
      await admin.from('daily_log_stops').update({ jobber_complete_error: msg, jobber_autopay: autopay }).eq('id', stopId)
      return { jobberPushed: false, warning: msg, autopay, itemsPushed: push.pushed, itemsFailed: unsynced.length }
    }

    if (!push.live.isComplete) {
      const out = await jobberGraphQLPatient<{ data?: { visitComplete?: { userErrors: UserErrors } } }>(jobberUserId, VISIT_COMPLETE, { visitId: stop.jobber_visit_id })
      const ue = errText(out.data?.visitComplete?.userErrors)
      if (ue) throw new Error(ue)
    }
    await admin.from('daily_log_stops').update({
      jobber_complete_pending: false, jobber_completed_at: new Date().toISOString(),
      jobber_complete_error: null, jobber_autopay: autopay,
    }).eq('id', stopId)
    return { jobberPushed: true, warning: null, autopay, itemsPushed: push.pushed, itemsFailed: 0 }
  } catch (e) {
    const msg = `Jobber: ${e instanceof Error ? e.message : 'push failed'} — retrying automatically.`
    await admin.from('daily_log_stops').update({ jobber_complete_error: msg }).eq('id', stopId)
    return { ...none, warning: msg }
  } finally {
    await releaseLock(admin, stopId)
    // Pull the visit back into the mirror so reports + the feed see the new items
    // — after the response, so the tech isn't kept waiting on a Jobber read.
    const visitId = stop.jobber_visit_id
    after(async () => {
      try { await refreshVisitsByExternalIds(companyId, [visitId]) } catch { /* the 10-min sweep catches it */ }
    })
  }
}

/** Retry cron: finish stops whose Jobber completion is still waiting. */
export async function retryPendingStopCompletions(companyId: string): Promise<{ tried: number; completed: number }> {
  const admin = createAdminClient()
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: stops } = await admin
    .from('daily_log_stops')
    .select('id, completed_by, daily_log_entries!inner(company_id)')
    .eq('jobber_complete_pending', true).eq('status', 'complete')
    .eq('daily_log_entries.company_id', companyId)
    .gte('completed_at', since)
    .limit(25)
  let completed = 0
  for (const s of stops ?? []) {
    const r = await completeStopInJobber(admin, companyId, s.id as string, (s.completed_by as string) ?? '')
    if (r.jobberPushed) completed++
  }
  return { tried: (stops ?? []).length, completed }
}
