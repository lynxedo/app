import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateProducts, loadProductsData, reqStr, strOrNull, numOrNull, boolOr, rateBasisOr, isErr } from '@/lib/products-server'

export const dynamic = 'force-dynamic'

// GET — the whole admin grid in one shot: items (+ sub-items + inventory), groups, locations.
export async function GET() {
  const ctx = await gateProducts()
  if ('error' in ctx) return ctx.error
  const admin = createAdminClient()
  const { products, categories, locations, error } = await loadProductsData(admin, ctx.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ products, categories, locations })
}

// POST — create an item (the physical product you buy).
export async function POST(request: Request) {
  const ctx = await gateProducts()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const name = reqStr(body.name, 1, 200)
  if (isErr(name)) return NextResponse.json({ error: `name ${name.err}` }, { status: 400 })

  const fields: Record<string, unknown> = { company_id: ctx.companyId, name }

  // category_id: uuid string or null
  if (body.category_id === null || body.category_id === undefined || body.category_id === '') fields.category_id = null
  else if (typeof body.category_id === 'string') fields.category_id = body.category_id
  else return NextResponse.json({ error: 'category_id invalid' }, { status: 400 })

  for (const [key, max] of [['description', 2000], ['unit', 40], ['epa_reg_number', 100], ['active_ingredient', 200], ['label_url', 1000], ['notes', 2000], ['batch_number', 100]] as const) {
    const v = strOrNull(body[key], max)
    if (isErr(v)) return NextResponse.json({ error: `${key} ${v.err}` }, { status: 400 })
    fields[key] = v
  }
  for (const key of ['package_price', 'package_size', 'application_rate'] as const) {
    const v = numOrNull(body[key])
    if (isErr(v)) return NextResponse.json({ error: `${key} ${v.err}` }, { status: 400 })
    fields[key] = v
  }
  const rb = rateBasisOr(body.rate_basis)
  if (isErr(rb)) return NextResponse.json({ error: `rate_basis ${rb.err}` }, { status: 400 })
  fields.rate_basis = rb

  if (body.batch_date === null || body.batch_date === undefined || body.batch_date === '') fields.batch_date = null
  else if (typeof body.batch_date === 'string') fields.batch_date = body.batch_date
  else return NextResponse.json({ error: 'batch_date invalid' }, { status: 400 })

  fields.is_active = boolOr(body.is_active, true)
  if (typeof body.sort_order === 'number') fields.sort_order = body.sort_order

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('products')
    .insert(fields)
    .select('*, product_location_inventory(*)')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ product: data })
}
