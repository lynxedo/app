import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateServiceMapping, parseProductRoundBody } from '@/lib/service-mapping-server'

export const dynamic = 'force-dynamic'

// POST — create a round for a program (never current on create; use set-current).
export async function POST(request: Request) {
  const ctx = await gateServiceMapping()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = parseProductRoundBody(body, false)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('product_rounds')
    .insert({ company_id: ctx.companyId, is_current: false, product_ids: [], ...parsed })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ round: data })
}
