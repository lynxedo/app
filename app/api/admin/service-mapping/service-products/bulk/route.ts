import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateServiceMapping, parseServiceProductBody } from '@/lib/service-mapping-server'

export const dynamic = 'force-dynamic'

// POST — create many mapping rows at once (legacy-rounds import, copy-to-round).
// All-or-nothing: every row validates first, then one insert.
export async function POST(request: Request) {
  const ctx = await gateServiceMapping()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const rows = body.rows
  if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: 'rows must be a non-empty array' }, { status: 400 })
  if (rows.length > 400) return NextResponse.json({ error: 'Too many rows (max 400)' }, { status: 400 })

  const parsedRows: Record<string, unknown>[] = []
  for (const r of rows) {
    if (typeof r !== 'object' || r === null) return NextResponse.json({ error: 'Each row must be an object' }, { status: 400 })
    const parsed = parseServiceProductBody(r as Record<string, unknown>, false)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    parsedRows.push({ company_id: ctx.companyId, ...parsed })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('service_products')
    .insert(parsedRows)
    .select('*')
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'One of these products is already mapped to that line item with the same start date.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ serviceProducts: data ?? [] })
}
