import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateProducts, reqStr, isErr } from '@/lib/products-server'

export const dynamic = 'force-dynamic'

// PATCH — rename / reorder / activate a location.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const ctx = await gateProducts()
  if ('error' in ctx) return ctx.error
  const { id } = await context.params

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = {}
  if ('name' in body) {
    const v = reqStr(body.name, 1, 100)
    if (isErr(v)) return NextResponse.json({ error: `name ${v.err}` }, { status: 400 })
    update.name = v
  }
  if ('sort_order' in body && typeof body.sort_order === 'number') update.sort_order = body.sort_order
  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') return NextResponse.json({ error: 'is_active must be boolean' }, { status: 400 })
    update.is_active = body.is_active
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('inventory_locations')
    .update(update)
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .select('*')
    .single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A location with that name already exists' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ location: data })
}

// DELETE — remove a location (its inventory rows cascade away).
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const ctx = await gateProducts()
  if ('error' in ctx) return ctx.error
  const { id } = await context.params

  const admin = createAdminClient()
  const { error } = await admin.from('inventory_locations').delete().eq('id', id).eq('company_id', ctx.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
