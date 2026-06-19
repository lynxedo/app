import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateServiceBuilder, parseChartBody } from '@/lib/service-builder-server'
import { computeMarginSnapshot, type PriceChart } from '@/lib/service-builder'
import type { Product } from '@/lib/products'

export const dynamic = 'force-dynamic'

// PATCH — update a program version (autosave + status changes). On a transition to
// 'published' we recompute the audit margin_snapshot server-side from the live catalog.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await gateServiceBuilder()
  if ('error' in ctx) return ctx.error
  const { id } = await params

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = parseChartBody(body, true)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (Object.keys(parsed).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const admin = createAdminClient()

  // Recompute the audit snapshot when publishing.
  if (parsed.status === 'published') {
    const [{ data: current }, { data: products }] = await Promise.all([
      admin.from('program_price_charts').select('*').eq('id', id).eq('company_id', ctx.companyId).single(),
      admin.from('products').select('*').eq('company_id', ctx.companyId).is('deleted_at', null),
    ])
    if (current) {
      const merged = { ...current, ...parsed } as PriceChart
      parsed.margin_snapshot = computeMarginSnapshot(merged, (products ?? []) as Product[], new Date().toISOString())
    }
  }

  const { data, error } = await admin
    .from('program_price_charts')
    .update({ ...parsed, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .is('deleted_at', null)
    .select('*')
    .single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A version with that label already exists for this program.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ chart: data })
}

// DELETE — soft delete (sets deleted_at). Never a hard delete (PRD safety rule).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await gateServiceBuilder()
  if ('error' in ctx) return ctx.error
  const { id } = await params

  const admin = createAdminClient()
  const { error } = await admin
    .from('program_price_charts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', ctx.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
