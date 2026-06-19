import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateProducts, reqStr, strOrNull, numOrNull, rateBasisOr, isErr } from '@/lib/products-server'

export const dynamic = 'force-dynamic'

// PATCH — update an item's fields (only the keys present in the body).
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const ctx = await gateProducts()
  if ('error' in ctx) return ctx.error
  const { id } = await context.params

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = {}

  if ('name' in body) {
    const v = reqStr(body.name, 1, 200)
    if (isErr(v)) return NextResponse.json({ error: `name ${v.err}` }, { status: 400 })
    update.name = v
  }
  if ('category_id' in body) {
    if (body.category_id === null || body.category_id === '') update.category_id = null
    else if (typeof body.category_id === 'string') update.category_id = body.category_id
    else return NextResponse.json({ error: 'category_id invalid' }, { status: 400 })
  }
  for (const [key, max] of [['description', 2000], ['unit', 40], ['epa_reg_number', 100], ['active_ingredient', 200], ['label_url', 1000], ['notes', 2000], ['batch_number', 100]] as const) {
    if (key in body) {
      const v = strOrNull(body[key], max)
      if (isErr(v)) return NextResponse.json({ error: `${key} ${v.err}` }, { status: 400 })
      update[key] = v
    }
  }
  for (const key of ['package_price', 'package_size', 'application_rate'] as const) {
    if (key in body) {
      const v = numOrNull(body[key])
      if (isErr(v)) return NextResponse.json({ error: `${key} ${v.err}` }, { status: 400 })
      update[key] = v
    }
  }
  if ('rate_basis' in body) {
    const v = rateBasisOr(body.rate_basis)
    if (isErr(v)) return NextResponse.json({ error: `rate_basis ${v.err}` }, { status: 400 })
    update.rate_basis = v
  }
  if ('batch_date' in body) {
    if (body.batch_date === null || body.batch_date === '') update.batch_date = null
    else if (typeof body.batch_date === 'string') update.batch_date = body.batch_date
    else return NextResponse.json({ error: 'batch_date invalid' }, { status: 400 })
  }
  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') return NextResponse.json({ error: 'is_active must be boolean' }, { status: 400 })
    update.is_active = body.is_active
  }
  if ('sort_order' in body && typeof body.sort_order === 'number') update.sort_order = body.sort_order

  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('products')
    .update(update)
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .select('*, product_location_inventory(*)')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ product: data })
}

// DELETE — soft-delete the product (sets deleted_at; the partial unique index frees the name).
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const ctx = await gateProducts()
  if ('error' in ctx) return ctx.error
  const { id } = await context.params

  const admin = createAdminClient()
  const { error } = await admin
    .from('products')
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', id)
    .eq('company_id', ctx.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
