import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateServiceMapping, parseServiceProductBody } from '@/lib/service-mapping-server'

export const dynamic = 'force-dynamic'

// POST — create a line-item → product mapping row.
export async function POST(request: Request) {
  const ctx = await gateServiceMapping()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = parseServiceProductBody(body, false)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('service_products')
    .insert({ company_id: ctx.companyId, ...parsed })
    .select('*')
    .single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That product is already mapped to this line item.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ serviceProduct: data })
}
