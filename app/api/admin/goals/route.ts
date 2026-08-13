import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGoalMetric, periodBounds, GOAL_GRAINS, type GoalGrain } from '@/lib/reports/goals'

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
  }
  const metric = String(body.metric || '').trim()
  const grain = String(body.grain || '').trim() as GoalGrain
  const periodStart = String(body.period_start || '').trim()
  const target = Number(body.target)

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

  // ⚠ Both ends are computed HERE, never taken from the client. The report reads
  // period_end to decide which goals overlap the range on screen, so a bad end
  // date would quietly hide or duplicate a target.
  const bounds = periodBounds(grain, periodStart)

  const admin = createAdminClient()
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
        created_by: ctx.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,metric,grain,period_start' }
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
