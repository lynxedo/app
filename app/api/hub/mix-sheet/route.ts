import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateMixSheetRead, gateMixSheetWrite, loadMixSheet, parseMixSheetConfigBody } from '@/lib/mix-sheet-server'
import { todayInTz } from '@/lib/service-mapping'

export const dynamic = 'force-dynamic'

// GET ?asOf=YYYY-MM-DD → the live sheet for that date (columns + programs +
// per-month config). Used when the user changes the date.
export async function GET(request: Request) {
  const ctx = await gateMixSheetRead()
  if ('error' in ctx) return ctx.error

  const url = new URL(request.url)
  let asOf = url.searchParams.get('asOf') || ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) asOf = todayInTz()

  const admin = createAdminClient()
  const payload = await loadMixSheet(admin, ctx.companyId, asOf)
  return NextResponse.json(payload)
}

// POST → upsert the per-month config (program selection / notes / granular box).
export async function POST(request: Request) {
  const ctx = await gateMixSheetWrite()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const admin = createAdminClient()

  // Manual column order is a company-wide preference (not per-month).
  if ('product_order' in body) {
    if (!Array.isArray(body.product_order)) return NextResponse.json({ error: 'product_order must be an array' }, { status: 400 })
    const order = body.product_order.filter((x): x is string => typeof x === 'string')
    const { error } = await admin
      .from('mix_sheet_settings')
      .upsert({ company_id: ctx.companyId, product_order: order, updated_at: new Date().toISOString() }, { onConflict: 'company_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const parsed = parseMixSheetConfigBody(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { error } = await admin
    .from('mix_sheets')
    .upsert({ company_id: ctx.companyId, ...parsed, updated_at: new Date().toISOString() }, { onConflict: 'company_id,period_key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
