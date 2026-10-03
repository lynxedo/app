import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkOrderStop, lineItemsLocked } from '@/lib/work-order-access'
import { loadStopLineItems } from '@/lib/work-order-line-items'

// PATCH  /api/hub/work-orders/stops/[id]/line-items/[itemId]
//        { quantity?, unitPrice?, description?, status?: 'accepted' | 'dismissed' }
//        Ben (Oct 2): techs may change quantity AND price, Jobber's items included.
// DELETE /api/hub/work-orders/stops/[id]/line-items/[itemId]
//        Removes it. Never deletes anything in Jobber (PRD rule 4): an item that
//        is already on the Jobber visit becomes quantity 0 ("not done"); one
//        that never reached Jobber is simply dropped.
// Nothing goes to Jobber here — Complete sends it (line items, then the visit).

type PatchBody = { quantity?: unknown; unitPrice?: unknown; description?: unknown; status?: unknown }

type ItemRow = {
  id: string
  source: string
  status: string
  quantity: number
  unit_price: number
  orig_quantity: number | null
  orig_unit_price: number | null
  jobber_line_item_id: string | null
  visit_only: boolean
}

const same = (a: unknown, b: unknown) => Math.abs(Number(a) - Number(b)) < 0.005

async function loadItem(admin: ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, stopId: string, itemId: string) {
  const { data } = await admin
    .from('work_order_line_items')
    .select('id, source, status, quantity, unit_price, orig_quantity, orig_unit_price, jobber_line_item_id, visit_only')
    .eq('id', itemId).eq('stop_id', stopId).is('deleted_at', null)
    .maybeSingle<ItemRow>()
  return data
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await ctx.params
  const r = await resolveWorkOrderStop(id)
  if ('error' in r) return r.error
  const { admin, stop, companyId, userId } = r
  const locked = lineItemsLocked(stop)
  if (locked) return NextResponse.json({ error: locked }, { status: 409 })

  const item = await loadItem(admin, stop.id, itemId)
  if (!item) return NextResponse.json({ error: 'Line item not found' }, { status: 404 })

  let body: PatchBody = {}
  try { body = (await req.json()) as PatchBody } catch { /* empty */ }

  const nowIso = new Date().toISOString()
  const patch: Record<string, unknown> = { edited_by: userId, edited_at: nowIso, updated_at: nowIso, sync_error: null, sync_attempts: 0 }
  let quantity = Number(item.quantity)
  let unitPrice = Number(item.unit_price)
  if (body.quantity !== undefined) {
    quantity = Number(body.quantity)
    if (!Number.isFinite(quantity) || quantity < 0 || quantity > 10000) return NextResponse.json({ error: 'Bad quantity' }, { status: 400 })
    patch.quantity = quantity
  }
  if (body.unitPrice !== undefined) {
    unitPrice = Number(body.unitPrice)
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000) return NextResponse.json({ error: 'Bad price' }, { status: 400 })
    patch.unit_price = unitPrice
  }
  if (typeof body.description === 'string') patch.description = body.description.slice(0, 2000)
  let status = item.status
  if (body.status === 'accepted' || body.status === 'dismissed') {
    status = body.status
    patch.status = status
  }

  // What has to go to Jobber at Complete. A Jobber item put back to exactly what
  // Jobber has (and never forked) needs nothing; a dismissed suggestion never goes.
  if (!stop.jobber_visit_id || status !== 'accepted') {
    patch.sync_state = 'synced'
  } else if (item.source === 'jobber' && !item.visit_only && same(quantity, item.orig_quantity) && same(unitPrice, item.orig_unit_price)) {
    patch.sync_state = 'synced'
  } else {
    patch.sync_state = 'pending'
  }

  const { error } = await admin.from('work_order_line_items').update(patch).eq('id', item.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: await loadStopLineItems(admin, companyId, stop) })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await ctx.params
  const r = await resolveWorkOrderStop(id)
  if ('error' in r) return r.error
  const { admin, stop, companyId, userId } = r
  const locked = lineItemsLocked(stop)
  if (locked) return NextResponse.json({ error: locked }, { status: 409 })

  const item = await loadItem(admin, stop.id, itemId)
  if (!item) return NextResponse.json({ error: 'Line item not found' }, { status: 404 })

  const nowIso = new Date().toISOString()
  const inJobber = !!item.jobber_line_item_id || item.source === 'jobber'
  let patch: Record<string, unknown>
  if (inJobber && stop.jobber_visit_id) {
    // On the Jobber visit → quantity 0, never a delete.
    patch = { quantity: 0, sync_state: 'pending', sync_error: null, sync_attempts: 0, edited_by: userId, edited_at: nowIso, updated_at: nowIso }
  } else if (item.source === 'inspection_suggested') {
    // Keep a turned-down suggestion so the inspection doesn't propose it again.
    patch = { status: 'dismissed', sync_state: 'synced', edited_by: userId, edited_at: nowIso, updated_at: nowIso }
  } else {
    patch = { deleted_at: nowIso, updated_at: nowIso, edited_by: userId, edited_at: nowIso }
  }
  const { error } = await admin.from('work_order_line_items').update(patch).eq('id', item.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: await loadStopLineItems(admin, companyId, stop) })
}
