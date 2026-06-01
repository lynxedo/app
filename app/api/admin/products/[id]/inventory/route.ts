import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateProducts, numOrNull, isErr } from '@/lib/products-server'

export const dynamic = 'force-dynamic'

// PUT — set the on-hand package count for one item at one location (upsert).
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const ctx = await gateProducts()
  if ('error' in ctx) return ctx.error
  const { id: productId } = await context.params

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const locationId = typeof body.location_id === 'string' ? body.location_id : ''
  if (!locationId) return NextResponse.json({ error: 'location_id required' }, { status: 400 })

  const qty = numOrNull(body.quantity)
  if (isErr(qty)) return NextResponse.json({ error: `quantity ${qty.err}` }, { status: 400 })
  const quantity = qty ?? 0

  const admin = createAdminClient()

  // Verify both the item and the location belong to this company before writing.
  const [{ data: prod }, { data: loc }] = await Promise.all([
    admin.from('products').select('id').eq('id', productId).eq('company_id', ctx.companyId).maybeSingle(),
    admin.from('inventory_locations').select('id').eq('id', locationId).eq('company_id', ctx.companyId).maybeSingle(),
  ])
  if (!prod) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  if (!loc) return NextResponse.json({ error: 'Location not found' }, { status: 404 })

  const { data, error } = await admin
    .from('product_location_inventory')
    .upsert(
      { company_id: ctx.companyId, product_id: productId, location_id: locationId, quantity, updated_at: new Date().toISOString() },
      { onConflict: 'product_id,location_id' },
    )
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ inventory: data })
}
