import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkOrderStop, lineItemsLocked } from '@/lib/work-order-access'
import { loadStopLineItems } from '@/lib/work-order-line-items'

// GET  /api/hub/work-orders/stops/[id]/line-items — the stop's line items
//      (seeded from the Jobber visit on first read) + its Jobber state.
// POST /api/hub/work-orders/stops/[id]/line-items — the tech adds an item
//      (from the catalog, or free text). Nothing goes to Jobber until Complete.
// Work Orders Phase 2 — PRD §6.

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const r = await resolveWorkOrderStop(id)
  if ('error' in r) return r.error
  const { admin, stop, companyId } = r
  const items = await loadStopLineItems(admin, companyId, stop)
  return NextResponse.json({
    items,
    locked: lineItemsLocked(stop),
    jobber: {
      has_visit: !!stop.jobber_visit_id,
      complete_pending: stop.jobber_complete_pending,
      completed_at: stop.jobber_completed_at,
      error: stop.jobber_complete_error,
      autopay: stop.jobber_autopay,
    },
  })
}

type AddBody = {
  name?: unknown
  description?: unknown
  quantity?: unknown
  unitPrice?: unknown
  taxable?: unknown
  jobberProductId?: unknown
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const r = await resolveWorkOrderStop(id)
  if ('error' in r) return r.error
  const { admin, stop, companyId, userId } = r
  const locked = lineItemsLocked(stop)
  if (locked) return NextResponse.json({ error: locked }, { status: 409 })

  let body: AddBody = {}
  try { body = (await req.json()) as AddBody } catch { /* empty */ }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 255) : ''
  const quantity = Number(body.quantity ?? 1)
  const unitPrice = Number(body.unitPrice ?? 0)
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 10000) return NextResponse.json({ error: 'Bad quantity' }, { status: 400 })
  if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000) return NextResponse.json({ error: 'Bad price' }, { status: 400 })
  const productId = typeof body.jobberProductId === 'string' && body.jobberProductId ? body.jobberProductId : null

  const existing = await loadStopLineItems(admin, companyId, stop)
  const nowIso = new Date().toISOString()
  const { data: row, error } = await admin.from('work_order_line_items').insert({
    company_id: companyId,
    stop_id: stop.id,
    source: 'tech_added',
    status: 'accepted',
    name,
    description: typeof body.description === 'string' ? body.description.slice(0, 2000) : null,
    quantity,
    unit_price: unitPrice,
    taxable: typeof body.taxable === 'boolean' ? body.taxable : null,
    jobber_product_id: productId,
    sync_state: stop.jobber_visit_id ? 'pending' : 'synced',
    added_by: userId,
    sort_order: existing.length,
    created_at: nowIso,
    updated_at: nowIso,
  }).select('id').single()
  if (error || !row) return NextResponse.json({ error: error?.message ?? 'Could not add' }, { status: 500 })

  // Recents for the picker (favorites + use counts are per tech).
  if (productId) {
    const { data: usage } = await admin
      .from('work_order_catalog_usage').select('id, use_count')
      .eq('user_id', userId).eq('jobber_product_id', productId).maybeSingle()
    if (usage) {
      await admin.from('work_order_catalog_usage')
        .update({ use_count: (usage.use_count as number) + 1, last_used_at: nowIso, product_name: name, updated_at: nowIso })
        .eq('id', usage.id)
    } else {
      await admin.from('work_order_catalog_usage').insert({
        company_id: companyId, user_id: userId, jobber_product_id: productId, product_name: name,
        use_count: 1, last_used_at: nowIso,
      })
    }
  }

  return NextResponse.json({ items: await loadStopLineItems(admin, companyId, stop) })
}
