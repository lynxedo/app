import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { REPORTS, PEOPLE_TEAM_SLUG } from '@/lib/reports/registry'
import ReportAccessPanel from './ReportAccessPanel'
import GoalsAdminPanel from './GoalsAdminPanel'
import { GOAL_METRICS } from '@/lib/reports/goals'

export const metadata = { title: 'Reports Admin' }

/* Per-report view grants — layer 2 of REPORTS_PRD §12.
 *
 * Mirrors Admin → Scoreboards, which does the same job for boards. Kept as its own
 * screen rather than a tab there because the two have separate section flags and
 * separate registries; merging them would put one gate's UI behind the other's.
 */

// Reports that expose pay. Flagged in the UI so granting them is a decision rather
// than a habit — this is the whole reason layer 2 exists (§12 always said pay-
// related figures are separately gated; until now the section flag covered both).
const PAY_SENSITIVE = new Set(['crew', 'service-lines'])

export default async function ReportsAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  // Full-admin function, matching Admin → Scoreboards. There is no per-area grant
  // for handing out report access — deciding who sees wages is not delegated.
  if (profile?.role !== 'admin' || !profile.company_id) redirect('/hub/home')
  const company = profile.company_id

  const admin = createAdminClient()
  const [{ data: reportUsers }, { data: hubUsers }, { data: grants }] = await Promise.all([
    // Only users holding the section flag can see any report, so they're the
    // candidates. Admins bypass grants entirely and are excluded from the matrix.
    admin
      .from('user_profiles')
      .select('id, full_name, role, can_access_reports')
      .eq('company_id', company)
      .eq('can_access_reports', true),
    admin
      .from('hub_users')
      .select('id, display_name'),
    admin
      .from('report_access')
      .select('user_id, report_slug')
      .eq('company_id', company),
  ])

  const nameById = new Map((hubUsers ?? []).map(u => [u.id, u.display_name]))
  const users = (reportUsers ?? [])
    .filter(u => u.role !== 'admin')
    .map(u => ({ id: u.id, name: (nameById.get(u.id)?.trim() || u.full_name?.trim() || 'Unnamed user') }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const access: Record<string, string[]> = {}
  for (const r of (grants ?? [])) (access[r.user_id] ??= []).push(r.report_slug)

  // Call Coaching is excluded: it answers to `can_access_coaching` alone (Admin →
  // People) and never reads report_access, so a toggle for it here would be a
  // control that does nothing — the exact kind of lie in the UI this project keeps
  // catching in self-review.
  const reports = REPORTS.filter(r => r.gate !== 'coaching').map(r => ({
    slug: r.slug,
    title: r.title,
    section: r.section,
    sensitive: PAY_SENSITIVE.has(r.slug),
  }))

  // Targets live on this screen too (Ben, 2026-08-13: "can't we just roll the
  // goals admin into the reports admin"). Two jobs, one page: who may READ a
  // report, and what the business is AIMING at on one of them.
  const { data: goalRows } = await admin
    .from('report_goals')
    .select('id, metric, grain, period_start, period_end, target')
    .eq('company_id', company)
    .order('period_start', { ascending: false })
    .limit(200)

  return (
    <div className="space-y-14">
      <ReportAccessPanel reports={reports} users={users} initialAccess={access} teamSlug={PEOPLE_TEAM_SLUG} />
      <GoalsAdminPanel
        metrics={GOAL_METRICS.map(m => ({ key: m.key, label: m.label, format: m.format, help: m.help }))}
        goals={(goalRows ?? []).map(g => ({
          id: g.id as string,
          metric: g.metric as string,
          grain: g.grain as 'month' | 'quarter' | 'year',
          period_start: g.period_start as string,
          period_end: g.period_end as string,
          target: Number(g.target),
        }))}
      />
    </div>
  )
}
