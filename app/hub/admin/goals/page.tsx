import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GOAL_METRICS } from '@/lib/reports/goals'
import GoalsAdminPanel from './GoalsAdminPanel'

export const metadata = { title: 'Goals Admin' }

/* Where the targets behind Reports → Goals & Targets are set (§8.11).
 *
 * Its own screen rather than a tab on Admin → Reports: that screen decides WHO
 * SEES a report, this one decides WHAT THE BUSINESS IS AIMING AT. Putting a
 * number-entry form inside a permissions matrix would blur two different jobs.
 */
export default async function GoalsAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' || !profile.company_id) redirect('/hub/home')

  const admin = createAdminClient()
  const { data: goals } = await admin
    .from('report_goals')
    .select('id, metric, grain, period_start, period_end, target')
    .eq('company_id', profile.company_id)
    .order('period_start', { ascending: false })
    .limit(200)

  return (
    <GoalsAdminPanel
      metrics={GOAL_METRICS.map(m => ({ key: m.key, label: m.label, format: m.format, help: m.help }))}
      goals={(goals ?? []).map(g => ({
        id: g.id as string,
        metric: g.metric as string,
        grain: g.grain as 'month' | 'quarter' | 'year',
        period_start: g.period_start as string,
        period_end: g.period_end as string,
        target: Number(g.target),
      }))}
    />
  )
}
