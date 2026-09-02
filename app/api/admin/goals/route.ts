import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getGoalMetric, metricSupportsPerson, metricAllowsGrain, grainsForMetric,
  periodBounds, GOAL_GRAINS, type GoalGrain,
} from '@/lib/reports/goals'

// Admin-only: set and clear the targets behind Reports → Goals & Targets (§8.11).
//
// `report_goals` has RLS on with NO policies, so it is service-role only and this
// route is the only way in — the same shape as the report_access grants.
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

export async function POST(request: Request) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as {
    metric?: string; grain?: string; period_start?: string; target?: number | string
    employee_id?: string | null; repeats?: boolean; id?: string
  }
  /* ⚠⚠ EDITING IS AN UPDATE BY ID, NOT AN UPSERT, and that distinction is the whole
   * reason this route could only create and delete before. The upsert below keys on
   * (metric, grain, period_start, employee_id, repeats) — the target's IDENTITY. So
   * re-saving the same target with a new NUMBER already worked, but changing anything
   * about WHICH period or WHOSE it is created a second row and left the original
   * standing, putting two contradictory targets on one report. With an id the row
   * moves instead of being duplicated. */
  const id = String(body.id || '').trim()
  const metric = String(body.metric || '').trim()
  const grain = String(body.grain || '').trim() as GoalGrain
  const periodStart = String(body.period_start || '').trim()
  const target = Number(body.target)
  // '' and 'company' both mean the company-wide target, so an empty select can
  // never be mistaken for a person.
  // ⚠ Defaults to FALSE, not to the form's default. A caller that does not mention
  // repetition is asking for one specific period, which is what every target stored
  // before this existed meant.
  const repeats = body.repeats === true
  const rawEmployee = String(body.employee_id ?? '').trim()
  const employeeId = rawEmployee && rawEmployee !== 'company' ? rawEmployee : null

  const metricDef = getGoalMetric(metric)
  if (!metricDef) {
    return NextResponse.json({ error: 'Unknown metric' }, { status: 400 })
  }
  if (!GOAL_GRAINS.includes(grain)) {
    return NextResponse.json({ error: 'Unknown period type' }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) {
    return NextResponse.json({ error: 'A period start date is required' }, { status: 400 })
  }
  if (!Number.isFinite(target) || target <= 0) {
    return NextResponse.json({ error: 'Target must be a number above zero' }, { status: 400 })
  }
  // ⚠ Refused rather than stored: retention and churn come from a function that
  // takes a YEAR, so a monthly retention target is not a smaller version of the
  // same question — nothing could ever measure it, and it would sit on the report
  // reading "No data" while looking like a commitment somebody made.
  if (!metricAllowsGrain(metric, grain)) {
    const allowed = grainsForMetric(metric)
      .map(x => (x === 'month' ? 'monthly' : x === 'quarter' ? 'quarterly' : 'yearly'))
    return NextResponse.json({
      error: `${metricDef.label} can only be set ${allowed.join(' or ')}. ${metricDef.help}`,
    }, { status: 400 })
  }
  // A percentage above 100 is a typo, not a stretch goal — and 8500 instead of 85
  // would render as a target nothing can ever reach.
  if (metricDef.format === 'percent' && target > 100) {
    return NextResponse.json({
      error: `${metricDef.label} is a percentage, so the target has to be 100 or less.`,
    }, { status: 400 })
  }

  const admin = createAdminClient()

  if (employeeId) {
    // ⚠ Refused rather than silently stored: three measures cannot be computed
    // for one person (see lib/reports/goals.ts), and a target with no reachable
    // actual would sit on the report reading "no data" forever while looking
    // like a real commitment somebody made.
    if (!metricSupportsPerson(metric)) {
      return NextResponse.json({
        error: metricDef.perPersonBlocker
          ? `${metricDef.label} cannot be set for one person. ${metricDef.perPersonBlocker}`
          : 'That measure cannot be set for one person.',
      }, { status: 400 })
    }
    // ⚠ An employee id is not authorization. The FK only proves the row exists,
    // not that it belongs to this admin's company, so check the company here.
    const { data: emp, error: empErr } = await admin
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .eq('company_id', ctx.company)
      .maybeSingle()
    if (empErr) return NextResponse.json({ error: empErr.message }, { status: 500 })
    if (!emp) return NextResponse.json({ error: 'That person is not on your roster' }, { status: 400 })
  }

  // ⚠ Both ends are computed HERE, never taken from the client. The report reads
  // period_end to decide which goals overlap the range on screen, so a bad end
  // date would quietly hide or duplicate a target.
  const bounds = periodBounds(grain, periodStart)

  if (id) {
    /* ⚠ Company-scoped, like every other write here: an id arriving from the browser
     * proves the row exists, never that it belongs to this admin's tenant.
     *
     * ⚠ `period_end` is recomputed rather than carried over. Editing a monthly target
     * into a quarterly one changes which periods it covers, and the Goals report reads
     * `period_end` to decide what overlaps the range on screen — a stale end date would
     * quietly hide the target or double it up. */
    const { data: updated, error: updErr } = await admin
      .from('report_goals')
      .update({
        metric, grain,
        period_start: bounds.start,
        period_end: bounds.end,
        target,
        employee_id: employeeId,
        repeats,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('company_id', ctx.company)
      .select('id')
    if (updErr) {
      /* 23505: the edit would collide with a DIFFERENT target that already covers this
       * measure, period and person. Refused rather than resolved for them — silently
       * overwriting the other row would delete a number somebody set on purpose. */
      if (updErr.code === '23505') {
        return NextResponse.json({
          error: 'Another target already covers that measure, period and person. Change this one to a different period, or remove the other first.',
        }, { status: 409 })
      }
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }
    // No rows matched: the id is not this company's, or it has since been removed.
    if (!updated?.length) {
      return NextResponse.json({ error: 'That target no longer exists' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, id, period: bounds, repeats })
  }

  // ⚠⚠ The conflict target includes employee_id and is backed by a NULLS NOT
  // DISTINCT unique index. Postgres treats NULLs as distinct by default, so with
  // an ordinary index re-saving a COMPANY target would insert a second row rather
  // than replace the first, putting two contradictory targets on one report.
  const { error } = await admin
    .from('report_goals')
    .upsert(
      {
        company_id: ctx.company,
        metric,
        grain,
        period_start: bounds.start,
        period_end: bounds.end,
        target,
        employee_id: employeeId,
        repeats,
        created_by: ctx.userId,
        updated_at: new Date().toISOString(),
      },
      // ⚠ `repeats` is part of the key so a standing monthly target and an override for
      // its own first month can coexist. See the migration for why both unique indexes
      // exist while this rolls out.
      { onConflict: 'company_id,metric,grain,period_start,employee_id,repeats' }
    )
  if (error) {
    // 23505 here means the pre-existing company-only unique index is still in
    // place (it is dropped in a follow-up migration once this code is live on
    // both envs), which blocks a person target that shadows a company one for
    // the same measure and period. Say that plainly instead of a raw 500.
    if (error.code === '23505') {
      // The older index, dropped in a follow-up migration once this code is live on
      // both environments, still blocks a repeating target from sharing a start period
      // with a one-off for the same measure. Say that plainly instead of a raw 500.
      return NextResponse.json({
        error: 'A target already exists for that measure and period. Remove it first, or pick a different period.',
      }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, period: bounds, repeats })
}

export async function DELETE(request: Request) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = String(new URL(request.url).searchParams.get('id') || '').trim()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const admin = createAdminClient()
  // Scoped to this admin's company: an id alone is not authorization.
  const { error } = await admin
    .from('report_goals')
    .delete()
    .eq('id', id)
    .eq('company_id', ctx.company)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
