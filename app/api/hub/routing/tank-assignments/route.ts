import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateRoutingUser } from '@/lib/route-capacity-server'

export const dynamic = 'force-dynamic'

// Per-route/day tank overrides (Part B). The "route" is the optimized run on
// screen (a tech's day or a holding batch) — keyed by a caller-supplied
// route_code + run_date. An override wins over service_products.tank_default
// for that product on that route/day; absence falls back to the default.

// GET ?route_code=...&run_date=YYYY-MM-DD → { assignments: { [product_id]: tank_number } }
export async function GET(request: Request) {
  const ctx = await gateRoutingUser()
  if ('error' in ctx) return ctx.error

  const url = new URL(request.url)
  const route_code = url.searchParams.get('route_code') ?? ''
  const run_date = url.searchParams.get('run_date') ?? ''
  if (!route_code || !run_date) return NextResponse.json({ error: 'route_code and run_date are required' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('route_tank_assignments')
    .select('product_id, tank_number')
    .eq('company_id', ctx.companyId)
    .eq('route_code', route_code)
    .eq('run_date', run_date)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const assignments: Record<string, number> = {}
  for (const row of data ?? []) assignments[row.product_id as string] = row.tank_number as number
  return NextResponse.json({ assignments })
}

// POST { route_code, run_date, product_id, tank_number|null }
//   tank_number 1–4 → upsert the override; null → clear it (revert to default).
export async function POST(request: Request) {
  const ctx = await gateRoutingUser()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const route_code = typeof body.route_code === 'string' ? body.route_code.trim() : ''
  const run_date = typeof body.run_date === 'string' ? body.run_date.trim() : ''
  const product_id = typeof body.product_id === 'string' ? body.product_id : ''
  if (!route_code || !run_date || !product_id) {
    return NextResponse.json({ error: 'route_code, run_date and product_id are required' }, { status: 400 })
  }

  const raw = body.tank_number
  const clearing = raw === null || raw === undefined || raw === ''
  const admin = createAdminClient()

  if (clearing) {
    const { error } = await admin
      .from('route_tank_assignments')
      .delete()
      .eq('company_id', ctx.companyId)
      .eq('route_code', route_code)
      .eq('run_date', run_date)
      .eq('product_id', product_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, cleared: true })
  }

  const tank_number = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(tank_number) || tank_number < 1 || tank_number > 4) {
    return NextResponse.json({ error: 'tank_number must be 1–4' }, { status: 400 })
  }

  const { error } = await admin
    .from('route_tank_assignments')
    .upsert(
      { company_id: ctx.companyId, route_code, run_date, product_id, tank_number },
      { onConflict: 'company_id,route_code,run_date,product_id' },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
