import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const check = await requireAdminArea('daily_log')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id }
}

export async function GET() {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('daily_log_skip_reasons')
    .select('id, label, sort_order, active, created_at')
    .eq('company_id', ctx.companyId)
    .order('sort_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ reasons: data ?? [] })
}

export async function POST(request: Request) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error

  const body = await request.json().catch(() => ({})) as {
    label?: unknown
    sort_order?: unknown
  }

  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (!label || label.length > 100) {
    return NextResponse.json({ error: 'label must be 1–100 characters' }, { status: 400 })
  }
  const sortOrder = typeof body.sort_order === 'number' ? Math.round(body.sort_order) : 0

  const admin = createAdminClient()
  const { data: inserted, error } = await admin
    .from('daily_log_skip_reasons')
    .insert({ company_id: ctx.companyId, label, sort_order: sortOrder })
    .select('id, label, sort_order, active, created_at')
    .single()

  if (error || !inserted) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }
  return NextResponse.json({ reason: inserted })
}
