import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  RATIO_UNITS, getBasis, isBandedKind, isTargetKind, normalizeTiers, rateKindAllowed,
  type CommissionPeriod, type TierMode,
} from '@/lib/reports/commission'

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

/** A YYYY-MM-DD date, or null. Undefined when the string is present but not a date. */
function optionalDate(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === '') return null
  const s = String(v).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
  // Rejects 2026-02-31: Date normalises it, so a round-trip that changes the string
  // means the date does not exist.
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? undefined : s
}

const PERIODS: CommissionPeriod[] = ['month', 'commission_weeks', 'week']
const TIER_MODE_KEYS: TierMode[] = ['marginal', 'flat']

/* ⚠⚠ ONLY THE TWO PRODUCTION BASES HAVE A WEEKLY FIGURE BEHIND THEM, because only
 * `scoreboard_commission_production` returns per-week buckets. A rule saved as weekly
 * on any other basis could never be paid, and the card would have to refuse it at
 * render time — so it is refused HERE, where the person choosing can still fix it. */
const BUCKETED_BASES = new Set(['revenue_produced', 'rev_per_hour'])

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
      error: RATIO_UNITS.has(basisDef.unit)
        ? `“${basisDef.label}” is a ratio, so it pays a flat bonus for hitting a target rather than a rate applied to it`
        : basisDef.unit === 'count'
          ? `“${basisDef.label}” is a count, so it pays a flat amount per unit rather than a percentage`
          : `“${basisDef.label}” is a dollar figure, so it pays a percentage rather than an amount per unit`,
    }, { status: 400 })
  }

  const target = isTargetKind(rateKind)

  let rate: number | null = null
  let tiers: { from: number; rate: number }[] | null = null
  if (isBandedKind(rateKind)) {
    tiers = normalizeTiers(body.tiers)
    if (!tiers.length) {
      return NextResponse.json({
        error: target
          ? 'A stepped bonus needs at least one band — a target and the amount it pays'
          : 'A tiered rule needs at least one band',
      }, { status: 400 })
    }
    /* ⚠ On a target rule a band's `rate` is DOLLARS, not a percentage, so the "over 100
     * is a typo" rule below must not apply to it — a $500 bonus band is ordinary. What
     * IS worth catching is a band paying nothing, which reads on the card as a target
     * that was hit and paid zero. */
    if (target && tiers.some(t => t.rate <= 0)) {
      return NextResponse.json({ error: 'Every band has to pay something — a band worth $0 looks like a bug on the card' }, { status: 400 })
    }
    /* ⚠ A band starting at zero is a band nobody can miss. On a higher-is-better figure
     * it pays unconditionally; on a lower-is-better one it can never be reached. Either
     * way the number on screen would not be describing what the rule does. */
    if (target && tiers.some(t => t.from <= 0)) {
      return NextResponse.json({ error: 'Every band needs a target above zero — a band at zero either always pays or never can' }, { status: 400 })
    }
  } else {
    const n = Number(body.rate)
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({
        error: target ? 'The bonus amount must be a number above zero' : 'Rate must be a number above zero',
      }, { status: 400 })
    }
    if (rateKind === 'percent' && n > 100) {
      return NextResponse.json({ error: 'A percentage above 100 is almost certainly a typo' }, { status: 400 })
    }
    rate = n
  }

  const threshold = optionalAmount(body.threshold)
  if (threshold === undefined) return NextResponse.json({ error: 'Threshold must be zero or more' }, { status: 400 })

  /* ⚠⚠ ON A FLAT TARGET RULE THE THRESHOLD IS THE TARGET, AND IT IS REQUIRED. Saved
   * blank, there is no line to be on the right side of, and the only comparison a
   * missing line can produce is one everybody passes — so the rule would pay its full
   * amount to every holder, every period, and read as though the targets were being
   * smashed. The database refuses this too; this is the message that explains it. */
  if (rateKind === 'target_flat' && (threshold == null || threshold <= 0)) {
    return NextResponse.json({
      error: basisDef.better === 'lower'
        ? 'Set the ceiling this bonus pays under — a blank or zero ceiling either pays every period or never can'
        : 'Set the target this bonus pays at — a blank or zero target pays every period',
    }, { status: 400 })
  }
  // A percentage target above 100 is a typo the same way a 200% commission rate is: it
  // would mean paying more in wages than the work was worth and calling it a win.
  if (target && basisDef.unit === 'percent') {
    const over = [
      ...(threshold != null ? [threshold] : []),
      ...(tiers ?? []).map(t => t.from),
    ].filter(v => v > 100)
    if (over.length) {
      return NextResponse.json({ error: 'A payroll share above 100% is almost certainly a typo' }, { status: 400 })
    }
  }

  /* ⚠ A cap is meaningless on a target rule — the flat amount IS the payout, so a cap
   * either does nothing or silently pays less than the rule says it does. Dropped
   * rather than rejected, so a rule edited from a rate basis to a target basis saves
   * instead of erroring about a field the editor no longer shows. */
  const cap = target ? null : optionalAmount(body.cap)
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

  /* ── the period and the tier shape ──────────────────────────────────────────
   * ⚠ Both default to today's behaviour when absent, so a caller that predates these
   * fields — or a form that does not send them — writes the rule it always wrote. */
  const period = (PERIODS as string[]).includes(String(body.period ?? 'month'))
    ? String(body.period ?? 'month') as CommissionPeriod
    : null
  if (!period) return NextResponse.json({ error: 'Unknown period' }, { status: 400 })
  if (period !== 'month' && !BUCKETED_BASES.has(basis)) {
    return NextResponse.json({
      error: `“${basisDef.label}” has no weekly figure behind it, so it cannot be paid by bonus week. Only “Revenue they produced” and “Their revenue per labour hour” can — everything else is measured over the whole period.`,
    }, { status: 400 })
  }

  const tierMode = (TIER_MODE_KEYS as string[]).includes(String(body.tier_mode ?? 'marginal'))
    ? String(body.tier_mode ?? 'marginal') as TierMode
    : null
  if (!tierMode) return NextResponse.json({ error: 'Unknown tier shape' }, { status: 400 })

  /* ── invoice verification ───────────────────────────────────────────────────
   * ⚠ Only meaningful on a counted basis: there is no per-unit invoice behind a
   * percentage of a dollar total. Silently dropped rather than rejected, so a rule
   * edited from Products to Sales saves instead of erroring about a hidden field. */
  const wantsVerify = basisDef.needs === 'items' && String(body.verify_source || '') === 'invoice'
  const verifySource = wantsVerify ? 'invoice' : null
  const minPrice = wantsVerify ? optionalAmount(body.min_price) : null
  if (minPrice === undefined) return NextResponse.json({ error: 'The least a sale can be worth must be zero or more' }, { status: 400 })
  const excludeRenewals = wantsVerify && body.exclude_renewals === true

  const effectiveFrom = optionalDate(body.effective_from)
  if (effectiveFrom === undefined) return NextResponse.json({ error: 'The “in force from” date is not a real date' }, { status: 400 })
  const effectiveTo = optionalDate(body.effective_to)
  if (effectiveTo === undefined) return NextResponse.json({ error: 'The “in force until” date is not a real date' }, { status: 400 })
  if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
    return NextResponse.json({ error: 'The rule cannot stop before it starts' }, { status: 400 })
  }

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
    period,
    tier_mode: tierMode,
    verify_source: verifySource,
    min_price: minPrice,
    exclude_renewals: excludeRenewals,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    updated_at: new Date().toISOString(),
  }

  const id = String(body.id || '').trim()

  /* ── superseding, rather than overwriting ───────────────────────────────────
   *
   * ⚠⚠ THIS IS WHAT MAKES A PAID MONTH STOP MOVING. Editing a rule in place mutates
   * the one row every period reads, so changing a rate silently repays every month
   * already closed — April 2026 was paid a flat $35 per upsell and cannot be
   * reproduced today because the rule now says 5%. With `supersede_from`, the current
   * version is closed the day before and the edit becomes a NEW version from that day,
   * so each period keeps reading the rule that was actually in force for it.
   *
   * ⚠ Both writes happen inside one database function, atomically. Done as two REST
   * calls, a failure between them would either leave two overlapping undated versions
   * (paying the bonus TWICE) or a gap (paying nothing) — and the first is much worse.
   */
  const supersedeFrom = optionalDate(body.supersede_from)
  if (supersedeFrom === undefined) {
    return NextResponse.json({ error: 'The date the new rate starts is not a real date' }, { status: 400 })
  }
  if (supersedeFrom && !id) {
    return NextResponse.json({ error: 'A new version has to supersede an existing rule' }, { status: 400 })
  }
  if (supersedeFrom && id) {
    const { data: newId, error } = await admin.rpc('commission_plan_supersede', {
      p_company_id: ctx.company,
      p_old_id: id,
      p_from: supersedeFrom,
      // ⚠ `company_id` and `effective_from` are set by the function from its own
      // parameters, not read from this payload — see the migration.
      p_new: { ...row, created_by: ctx.userId, effective_from: undefined, effective_to: undefined },
    })
    if (error) {
      if (error.code === 'P0002') return NextResponse.json({ error: 'That rule no longer exists' }, { status: 404 })
      if (error.code === '23514' || error.message?.includes('must start after')) {
        return NextResponse.json({ error: error.message.replace(/^.*?:\s*/, '') }, { status: 400 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, id: newId, superseded: id, from: supersedeFrom })
  }

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
