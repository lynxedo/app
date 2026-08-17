import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBasis, rateKindAllowed, normalizeTiers } from '@/lib/reports/commission'

// Admin-only: the bonus rules behind the Commission cards.
//
// `commission_plans` has RLS on with NO policies, so it is service-role only and this
// route is the only way in — the same shape as report_goals and the report_access
// grants. This is pay data; there is no second net below this route.
async function getAdminContext(): Promise<{ company: string; userId: string } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.role !== 'admin' || !profile.company_id) return null
  return { company: profile.company_id as string, userId: user.id }
}

/** Null for blank/absent, a finite non-negative number otherwise, or undefined if invalid. */
function optionalAmount(v: unknown): number | null | undefined {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return undefined
  return n
}

export async function POST(request: Request) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as Record<string, unknown>

  const employeeId = String(body.employee_id || '').trim()
  const label = String(body.label || '').trim()
  const basis = String(body.basis || '').trim()
  const rateKind = String(body.rate_kind || 'percent').trim()

  if (!employeeId) return NextResponse.json({ error: 'Pick a person' }, { status: 400 })
  if (!label) return NextResponse.json({ error: 'Give the rule a name' }, { status: 400 })

  const basisDef = getBasis(basis)
  if (!basisDef) return NextResponse.json({ error: 'Unknown basis' }, { status: 400 })

  // ⚠ The pairing is validated, not just each field: a percentage of a COUNT and a
  // flat amount per unit of a DOLLAR figure are both meaningless, and a rule that
  // could only ever produce a nonsense number should not be saveable.
  if (!rateKindAllowed(basis, rateKind)) {
    return NextResponse.json({
      error: basisDef.unit === 'count'
        ? `“${basisDef.label}” is a count, so it pays a flat amount per unit rather than a percentage`
        : `“${basisDef.label}” is a dollar figure, so it pays a percentage rather than an amount per unit`,
    }, { status: 400 })
  }

  let rate: number | null = null
  let tiers: { from: number; rate: number }[] | null = null
  if (rateKind === 'tiered') {
    tiers = normalizeTiers(body.tiers)
    if (!tiers.length) {
      return NextResponse.json({ error: 'A tiered rule needs at least one band' }, { status: 400 })
    }
  } else {
    const n = Number(body.rate)
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: 'Rate must be a number above zero' }, { status: 400 })
    }
    if (rateKind === 'percent' && n > 100) {
      return NextResponse.json({ error: 'A percentage above 100 is almost certainly a typo' }, { status: 400 })
    }
    rate = n
  }

  const threshold = optionalAmount(body.threshold)
  const cap = optionalAmount(body.cap)
  if (threshold === undefined) return NextResponse.json({ error: 'Threshold must be zero or more' }, { status: 400 })
  if (cap === undefined) return NextResponse.json({ error: 'Cap must be zero or more' }, { status: 400 })

  let linePrefix: string | null = null
  if (basisDef.needs === 'line') {
    linePrefix = String(body.line_prefix || '').trim() || null
    if (!linePrefix) return NextResponse.json({ error: 'Pick which service line this rides on' }, { status: 400 })
  }

  let items: string[] | null = null
  if (basisDef.needs === 'items') {
    // Bounded rather than whitelisted, for the same reason the tracked-item picker is:
    // these are the tenant's own product names, only ever used to match rows already
    // scoped to their company.
    items = [...new Set(
      (Array.isArray(body.items) ? body.items : [])
        .map(v => String(v).trim())
        .filter(Boolean)
        .slice(0, 60)
        .map(v => v.slice(0, 200)),
    )]
    if (!items.length) return NextResponse.json({ error: 'Pick at least one item' }, { status: 400 })
  }

  const admin = createAdminClient()

  // ⚠ The employee must belong to THIS admin's company. An id alone is not
  // authorization, and this one arrives from the browser.
  const { data: emp } = await admin
    .from('employees')
    .select('id')
    .eq('id', employeeId)
    .eq('company_id', ctx.company)
    .maybeSingle()
  if (!emp) return NextResponse.json({ error: 'That person is not on your roster' }, { status: 400 })

  const row = {
    company_id: ctx.company,
    employee_id: employeeId,
    label,
    basis,
    rate_kind: rateKind,
    rate,
    tiers,
    threshold,
    cap,
    line_prefix: linePrefix,
    items,
    active: body.active === undefined ? true : !!body.active,
    sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
    updated_at: new Date().toISOString(),
  }

  const id = String(body.id || '').trim()
  if (id) {
    // Company-scoped update: editing by id must not reach another tenant's row.
    const { error } = await admin
      .from('commission_plans')
      .update(row)
      .eq('id', id)
      .eq('company_id', ctx.company)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id })
  }

  const { data, error } = await admin
    .from('commission_plans')
    .insert({ ...row, created_by: ctx.userId })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data?.id })
}

export async function DELETE(request: Request) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = String(new URL(request.url).searchParams.get('id') || '').trim()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('commission_plans')
    .delete()
    .eq('id', id)
    .eq('company_id', ctx.company)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
