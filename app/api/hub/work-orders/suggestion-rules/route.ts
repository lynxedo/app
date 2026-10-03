import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { RULE_FIELDS } from '@/lib/work-order-suggestions'

// The office's "Suggested from inspection" rules (Work Orders Phase 2, Part 2).
//   GET    → { rules, fields }
//   POST   → create   { trigger_kind, trigger_text?, head_filter?, trigger_field?, trigger_value?,
//                       jobber_product_id, product_name, quantity_mode, fixed_quantity? }
//   PATCH  → update   { id, ...same fields, is_active? }
//   DELETE → ?id=…    (soft)
// Daily Log admins only (role admin / can_admin_daily_log).

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

const COLS = 'id, trigger_kind, trigger_text, head_filter, trigger_field, trigger_value, jobber_product_id, product_name, quantity_mode, fixed_quantity, is_active, sort_order, updated_at'

type Body = Record<string, unknown>

/** Validate + normalise the editable fields. Returns an error string or the patch. */
function clean(body: Body, partial: boolean): string | Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : null)
  if (!partial || body.trigger_kind !== undefined) {
    if (body.trigger_kind !== 'zone_issue' && body.trigger_kind !== 'field') return 'Pick what the rule looks at'
    out.trigger_kind = body.trigger_kind
  }
  for (const k of ['trigger_text', 'head_filter', 'trigger_value'] as const) if (body[k] !== undefined) out[k] = str(body[k]) || null
  if (body.trigger_field !== undefined) {
    const f = str(body.trigger_field)
    if (f && !RULE_FIELDS.some(x => x.key === f)) return 'Unknown inspection field'
    out.trigger_field = f || null
  }
  if (!partial || body.jobber_product_id !== undefined) {
    const id = str(body.jobber_product_id, 100)
    const name = str(body.product_name, 255)
    if (!id || !name) return 'Pick a catalog item'
    out.jobber_product_id = id
    out.product_name = name
  }
  if (!partial || body.quantity_mode !== undefined) {
    if (!['number_in_text', 'per_zone', 'fixed'].includes(body.quantity_mode as string)) return 'Pick how to count the quantity'
    out.quantity_mode = body.quantity_mode
  }
  if (body.fixed_quantity !== undefined) {
    const n = Number(body.fixed_quantity)
    if (!Number.isFinite(n) || n <= 0 || n > 1000) return 'Bad quantity'
    out.fixed_quantity = n
  }
  if (body.is_active !== undefined) out.is_active = body.is_active === true
  if (body.sort_order !== undefined && Number.isFinite(Number(body.sort_order))) out.sort_order = Number(body.sort_order)
  return out
}

function complete(rule: Record<string, unknown>): string | null {
  if (rule.trigger_kind === 'zone_issue' && !rule.trigger_text) return 'Type the word(s) to look for in a zone’s issues'
  if (rule.trigger_kind === 'field' && (!rule.trigger_field || !rule.trigger_value)) return 'Pick the inspection field and its value'
  return null
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('inspection_suggestion_rules').select(COLS)
    .eq('company_id', g.companyId).is('deleted_at', null)
    .order('sort_order', { ascending: true }).order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rules: data ?? [], fields: RULE_FIELDS })
}

export async function POST(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  let body: Body = {}
  try { body = await req.json() } catch { /* empty */ }
  const c = clean(body, false)
  if (typeof c === 'string') return NextResponse.json({ error: c }, { status: 400 })
  const missing = complete(c)
  if (missing) return NextResponse.json({ error: missing }, { status: 400 })
  const admin = createAdminClient()
  const { data, error } = await admin.from('inspection_suggestion_rules')
    .insert({ ...c, company_id: g.companyId, created_by: g.userId }).select(COLS).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rule: data })
}

export async function PATCH(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  let body: Body = {}
  try { body = await req.json() } catch { /* empty */ }
  if (typeof body.id !== 'string') return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const c = clean(body, true)
  if (typeof c === 'string') return NextResponse.json({ error: c }, { status: 400 })
  const admin = createAdminClient()
  const { data: cur } = await admin.from('inspection_suggestion_rules').select(COLS)
    .eq('id', body.id).eq('company_id', g.companyId).is('deleted_at', null).maybeSingle()
  if (!cur) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
  const missing = complete({ ...cur, ...c })
  if (missing) return NextResponse.json({ error: missing }, { status: 400 })
  const { data, error } = await admin.from('inspection_suggestion_rules')
    .update({ ...c, updated_at: new Date().toISOString() })
    .eq('id', body.id).eq('company_id', g.companyId).select(COLS).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rule: data })
}

export async function DELETE(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const admin = createAdminClient()
  const { error } = await admin.from('inspection_suggestion_rules')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id).eq('company_id', g.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
