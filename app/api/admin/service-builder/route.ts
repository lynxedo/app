import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateServiceBuilder, loadServiceBuilderData, parseChartBody } from '@/lib/service-builder-server'

export const dynamic = 'force-dynamic'

// GET — the whole Builder screen: program versions, the live product catalog, seeded rounds.
export async function GET() {
  const ctx = await gateServiceBuilder()
  if ('error' in ctx) return ctx.error
  const admin = createAdminClient()
  const { charts, products, rounds, error } = await loadServiceBuilderData(admin, ctx.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ charts, products, rounds })
}

// POST — create a new program version (always starts as a draft unless told otherwise).
export async function POST(request: Request) {
  const ctx = await gateServiceBuilder()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = parseChartBody(body, false)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const fields = { company_id: ctx.companyId, status: 'draft', ...parsed }

  const admin = createAdminClient()
  const { data, error } = await admin.from('program_price_charts').insert(fields).select('*').single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A version with that label already exists for this program.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ chart: data })
}
