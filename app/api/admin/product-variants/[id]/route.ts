import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateProducts, strOrNull, numOrNull, rateBasisOr, isErr } from '@/lib/products-server'

export const dynamic = 'force-dynamic'

// PATCH — edit a sub-item (rate).
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const ctx = await gateProducts()
  if ('error' in ctx) return ctx.error
  const { id } = await context.params

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = {}
  if ('label' in body) {
    const v = strOrNull(body.label, 200)
    if (isErr(v)) return NextResponse.json({ error: `label ${v.err}` }, { status: 400 })
    update.label = v
  }
  if ('notes' in body) {
    const v = strOrNull(body.notes, 1000)
    if (isErr(v)) return NextResponse.json({ error: `notes ${v.err}` }, { status: 400 })
    update.notes = v
  }
  if ('application_rate' in body) {
    const v = numOrNull(body.application_rate)
    if (isErr(v)) return NextResponse.json({ error: `application_rate ${v.err}` }, { status: 400 })
    update.application_rate = v
  }
  if ('rate_basis' in body) {
    const v = rateBasisOr(body.rate_basis)
    if (isErr(v)) return NextResponse.json({ error: `rate_basis ${v.err}` }, { status: 400 })
    update.rate_basis = v
  }
  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') return NextResponse.json({ error: 'is_active must be boolean' }, { status: 400 })
    update.is_active = body.is_active
  }
  if ('sort_order' in body && typeof body.sort_order === 'number') update.sort_order = body.sort_order

  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('product_variants')
    .update(update)
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ variant: data })
}

// DELETE — remove a sub-item.
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const ctx = await gateProducts()
  if ('error' in ctx) return ctx.error
  const { id } = await context.params

  const admin = createAdminClient()
  const { error } = await admin.from('product_variants').delete().eq('id', id).eq('company_id', ctx.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
