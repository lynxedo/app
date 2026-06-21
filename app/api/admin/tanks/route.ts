import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateTankAdmin, parseTankBody } from '@/lib/route-capacity-server'

export const dynamic = 'force-dynamic'

// GET — list this company's tanks (Part A).
export async function GET() {
  const ctx = await gateTankAdmin()
  if ('error' in ctx) return ctx.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tank_configs')
    .select('id, tank_number, label, gallon_capacity, application_rate, is_active, created_at, updated_at')
    .eq('company_id', ctx.companyId)
    .order('tank_number', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tanks: data ?? [] })
}

// POST — add a tank.
export async function POST(request: Request) {
  const ctx = await gateTankAdmin()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = parseTankBody(body, false)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tank_configs')
    .insert({ company_id: ctx.companyId, ...parsed })
    .select('id, tank_number, label, gallon_capacity, application_rate, is_active, created_at, updated_at')
    .single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A tank with that number already exists.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ tank: data })
}
