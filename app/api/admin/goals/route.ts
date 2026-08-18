import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGoalMetric, metricSupportsPerson, periodBounds, GOAL_GRAINS, type GoalGrain } from '@/lib/reports/goals'

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
    employee_id?: string | null
  }
  const metric = String(body.metric || '').trim()
  const grain = String(body.grain || '').trim() as GoalGrain
  const periodStart = String(body.period_start || '').trim()
  const target = Number(body.target)
  // '' and 'company' both mean the company-wide target, so an empty select can
  // never be mistaken for a person.
  const rawEmployee = String(body.employee_id ?? '').trim()
  const employeeId = rawEmployee && rawEmployee !== 'company' ? rawEmployee : null

  if (!getGoalMetric(metric)) {
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

  const admin = createAdminClient()

  if (employeeId) {
    // ⚠ Refused rather than silently stored: three measures cannot be computed
    // for one person (see lib/reports/goals.ts), and a target with no reachable
    // actual would sit on the report reading "no data" forever while looking
    // like a real commitment somebody made.
    if (!metricSupportsPerson(metric)) {
      const m = getGoalMetric(metric)
      return NextResponse.json({
        error: m?.perPersonBlocker
          ? `${m.label} cannot be set for one person. ${m.perPersonBlocker}`
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
        created_by: ctx.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,metric,grain,period_start,employee_id' }
    )
  if (error) {
    // 23505 here means the pre-existing company-only unique index is still in
    // place (it is dropped in a follow-up migration once this code is live on
    // both envs), which blocks a person target that shadows a company one for
    // the same measure and period. Say that plainly instead of a raw 500.
    if (error.code === '23505') {
      return NextResponse.json({
        error: 'A company-wide target already exists for that measure and period. Remove it first, or pick a different period.',
      }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, period: bounds })
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
