import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// The office's Report text (Work Orders Phase 3): what each treatment does and
// the care instructions, in the customer's words — copied into an
// after-service report when the tech saves it.
//   GET    → { texts, services }   services = treatment line items + their rounds
//                                  (from Service Mapping) to help pick a name
//   POST   → create { service_name, round_label?, description, care }
//   PATCH  → update { id, …same fields, is_active? }
//   DELETE → ?id=…  (soft)
// Daily Log admins only (role admin / can_admin_daily_log), like Inspection rules.

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase
    .from('user_profiles').select('company_id, role, can_admin_daily_log').eq('id', user.id).single()
  if (!profile?.company_id) return { error: NextResponse.json({ error: 'No company' }, { status: 403 }) }
  if (profile.role !== 'admin' && profile.can_admin_daily_log !== true) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { userId: user.id, companyId: profile.company_id as string }
}

const COLS = 'id, service_name, round_label, description, care, is_active, updated_by, updated_at'

function clean(body: Record<string, unknown>, partial: boolean): string | Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  if (!partial || body.service_name !== undefined) {
    const n = str(body.service_name, 200)
    if (!n) return 'Enter the service (the Jobber line item name, e.g. “Lawn Health Basic”)'
    out.service_name = n
  }
  if (body.round_label !== undefined) out.round_label = str(body.round_label, 80) || null
  if (!partial || body.description !== undefined) out.description = str(body.description, 4000)
  if (!partial || body.care !== undefined) out.care = str(body.care, 4000)
  if (body.is_active !== undefined) out.is_active = body.is_active === true
  return out
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const admin = createAdminClient()
  const [{ data: texts }, { data: batches }] = await Promise.all([
    admin.from('after_service_templates').select(COLS)
      .eq('company_id', g.companyId).is('deleted_at', null)
      .order('service_name', { ascending: true }).order('round_label', { ascending: true, nullsFirst: true }),
    admin.from('service_products').select('jobber_line_item_name, batch_label')
      .eq('company_id', g.companyId).eq('is_active', true).is('deleted_at', null),
  ])
  const services = new Map<string, Set<string>>()
  for (const b of (batches ?? []) as { jobber_line_item_name: string; batch_label: string | null }[]) {
    const name = (b.jobber_line_item_name ?? '').trim()
    if (!name) continue
    if (!services.has(name)) services.set(name, new Set())
    if (b.batch_label) services.get(name)!.add(b.batch_label)
  }
  const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
  return NextResponse.json({
    texts: texts ?? [],
    services: Array.from(services.entries()).sort((a, b) => natural(a[0], b[0])).map(([name, rounds]) => ({ name, rounds: Array.from(rounds).sort(natural) })),
  })
}

export async function POST(request: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  const body = await request.json().catch(() => ({}))
  const c = clean(body, false)
  if (typeof c === 'string') return NextResponse.json({ error: c }, { status: 400 })
  const { data, error } = await createAdminClient().from('after_service_templates')
    .insert({ ...c, company_id: g.companyId, created_by: g.userId, updated_by: g.userId })
    .select(COLS).single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'There is already text for that service and round — edit it instead.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ text: data })
}

export async function PATCH(request: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : null
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const c = clean(body, true)
  if (typeof c === 'string') return NextResponse.json({ error: c }, { status: 400 })
  const { data, error } = await createAdminClient().from('after_service_templates')
    .update({ ...c, updated_by: g.userId, updated_at: new Date().toISOString() })
    .eq('id', id).eq('company_id', g.companyId).is('deleted_at', null)
    .select(COLS).maybeSingle()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'There is already text for that service and round.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ text: data })
}

export async function DELETE(request: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await createAdminClient().from('after_service_templates')
    .update({ deleted_at: new Date().toISOString(), updated_by: g.userId })
    .eq('id', id).eq('company_id', g.companyId).is('deleted_at', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
