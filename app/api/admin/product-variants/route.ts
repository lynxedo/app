import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateProducts, strOrNull, numOrNull, rateBasisOr, boolOr, isErr } from '@/lib/products-server'

export const dynamic = 'force-dynamic'

// POST — add a sub-item (a rate) under an item.
export async function POST(request: Request) {
  const ctx = await gateProducts()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const productId = typeof body.product_id === 'string' ? body.product_id : ''
  if (!productId) return NextResponse.json({ error: 'product_id required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: prod } = await admin.from('products').select('id').eq('id', productId).eq('company_id', ctx.companyId).maybeSingle()
  if (!prod) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const label = strOrNull(body.label, 200)
  if (isErr(label)) return NextResponse.json({ error: `label ${label.err}` }, { status: 400 })
  const notes = strOrNull(body.notes, 1000)
  if (isErr(notes)) return NextResponse.json({ error: `notes ${notes.err}` }, { status: 400 })
  const rate = numOrNull(body.application_rate)
  if (isErr(rate)) return NextResponse.json({ error: `application_rate ${rate.err}` }, { status: 400 })
  const rateBasis = rateBasisOr(body.rate_basis)
  if (isErr(rateBasis)) return NextResponse.json({ error: `rate_basis ${rateBasis.err}` }, { status: 400 })

  const fields: Record<string, unknown> = {
    company_id: ctx.companyId,
    product_id: productId,
    label,
    application_rate: rate,
    rate_basis: rateBasis,
    notes,
    is_active: boolOr(body.is_active, true),
  }
  if (typeof body.sort_order === 'number') fields.sort_order = body.sort_order

  const { data, error } = await admin.from('product_variants').insert(fields).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ variant: data })
}
