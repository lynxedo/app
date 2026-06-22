import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateRoutingUser } from '@/lib/route-capacity-server'

export const dynamic = 'force-dynamic'

// Per-route/day tank overrides (Part B). The "route" is the optimized run on
// screen (a tech's day or a holding batch) — keyed by a caller-supplied
// route_code + run_date. Overrides are keyed by the service_products mapping
// (service_product_id), NOT the bare product, so the same product on two line
// items can go in two tanks. An override wins over service_products.tank_default
// for that mapping on that route/day; absence falls back to the default.
// (Rows leave product_id NULL — see migration route_tank_assignments_by_service_product.)

// GET ?route_code=...&run_date=YYYY-MM-DD → { assignments: { [service_product_id]: tank_number } }
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
    .select('service_product_id, tank_number')
    .eq('company_id', ctx.companyId)
    .eq('route_code', route_code)
    .eq('run_date', run_date)
    .not('service_product_id', 'is', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const assignments: Record<string, number> = {}
  for (const row of data ?? []) assignments[row.service_product_id as string] = row.tank_number as number
  return NextResponse.json({ assignments })
}

// POST { route_code, run_date, service_product_id, tank_number|null }
//   tank_number 1–4 → upsert the override; null → clear it (revert to default).
export async function POST(request: Request) {
  const ctx = await gateRoutingUser()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const route_code = typeof body.route_code === 'string' ? body.route_code.trim() : ''
  const run_date = typeof body.run_date === 'string' ? body.run_date.trim() : ''
  const service_product_id = typeof body.service_product_id === 'string' ? body.service_product_id : ''
  if (!route_code || !run_date || !service_product_id) {
    return NextResponse.json({ error: 'route_code, run_date and service_product_id are required' }, { status: 400 })
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
      .eq('service_product_id', service_product_id)
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
      { company_id: ctx.companyId, route_code, run_date, service_product_id, tank_number },
      { onConflict: 'company_id,route_code,run_date,service_product_id' },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
