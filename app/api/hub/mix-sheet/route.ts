import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateMixSheet, loadMixSheet, parseMixSheetConfigBody } from '@/lib/mix-sheet-server'
import { todayInTz } from '@/lib/service-mapping'

export const dynamic = 'force-dynamic'

// GET ?asOf=YYYY-MM-DD → the live sheet for that date (columns + programs +
// per-month config). Used when the user changes the date.
export async function GET(request: Request) {
  const ctx = await gateMixSheet()
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
  const ctx = await gateMixSheet()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = parseMixSheetConfigBody(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('mix_sheets')
    .upsert({ company_id: ctx.companyId, ...parsed, updated_at: new Date().toISOString() }, { onConflict: 'company_id,period_key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
