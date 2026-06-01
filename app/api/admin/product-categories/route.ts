import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateProducts, reqStr, isErr } from '@/lib/products-server'

export const dynamic = 'force-dynamic'

// POST — add a product group (category).
export async function POST(request: Request) {
  const ctx = await gateProducts()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const name = reqStr(body.name, 1, 100)
  if (isErr(name)) return NextResponse.json({ error: `name ${name.err}` }, { status: 400 })

  const fields: Record<string, unknown> = { company_id: ctx.companyId, name }
  if (typeof body.sort_order === 'number') fields.sort_order = body.sort_order

  const admin = createAdminClient()
  const { data, error } = await admin.from('product_categories').insert(fields).select('*').single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A group with that name already exists' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ category: data })
}
