import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { REPORTS, PEOPLE_TEAM_SLUG } from '@/lib/reports/registry'
import ReportAccessPanel from './ReportAccessPanel'
import GoalsAdminPanel from './GoalsAdminPanel'
import CommissionAdminPanel from './CommissionAdminPanel'
import { GOAL_METRICS } from '@/lib/reports/goals'
import { normalizeTiers, type CommissionBasis, type RateKind } from '@/lib/reports/commission'

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

  /* Commission plans live here too, for the same reason targets do: this screen is
   * already "what the business is aiming at, and who may read it". The rules feed
   * widgets you add to any scoreboard — there is deliberately no Commission page.
   *
   * Three lookups feed the editor's pickers. Each is the tenant's own data, and the
   * employee list is what plans are KEYED on, so it has to be the roster rather than
   * any name string. */
  const [{ data: planRows }, { data: empRows }, { data: defRows }, itemsRes] = await Promise.all([
    admin
      .from('commission_plans')
      .select('id, employee_id, label, basis, rate_kind, rate, tiers, threshold, cap, line_prefix, items, active, sort_order')
      .eq('company_id', company)
      .order('sort_order', { ascending: true }),
    admin
      .from('employees')
      .select('id, first_name, last_name, preferred_name, department, is_active')
      .eq('company_id', company)
      .order('is_active', { ascending: false })
      .order('first_name', { ascending: true }),
    admin
      .from('recurring_program_definitions')
      .select('dept_prefix')
      .eq('company_id', company),
    admin.rpc('scoreboard_lead_items', {
      p_company_id: company,
      p_start: '1900-01-01',
      p_end: '2999-12-31',
      p_basis: 'created',
      p_stages: null,
    }),
  ])

  const employees = (empRows ?? []).map(e => ({
    id: e.id as string,
    // Composed the way the roster composes it, so the editor and Admin → People agree
    // on what somebody is called.
    name: [String(e.preferred_name || e.first_name || '').trim(), String(e.last_name || '').trim()]
      .filter(Boolean).join(' ') || 'Unknown',
    department: (e.department as string | null) ?? null,
    is_active: e.is_active !== false,
  }))
  const empName = new Map(employees.map(e => [e.id, e.name]))

  const lines = [...new Set((defRows ?? [])
    .map(d => (d.dept_prefix as string | null)?.trim())
    .filter((v): v is string => !!v))].sort()

  const itemRow = itemsRes.data as { rows?: { value: string; leads: number }[] } | null
  const itemTotals = new Map<string, number>()
  for (const r of itemRow?.rows ?? []) {
    const v = r.value?.trim()
    if (v) itemTotals.set(v, (itemTotals.get(v) ?? 0) + Number(r.leads || 0))
  }
  const items = [...itemTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([v]) => v)

  const plans = (planRows ?? []).map(p => ({
    id: p.id as string,
    employee_id: p.employee_id as string,
    // A plan whose person left the roster still shows, named, rather than vanishing —
    // the widgets report it as uncounted and the admin needs to find it to delete it.
    person: empName.get(p.employee_id as string) ?? 'No longer on the roster',
    label: p.label as string,
    basis: p.basis as CommissionBasis,
    rate_kind: p.rate_kind as RateKind,
    rate: p.rate == null ? null : Number(p.rate),
    tiers: p.tiers == null ? null : normalizeTiers(p.tiers),
    threshold: p.threshold == null ? null : Number(p.threshold),
    cap: p.cap == null ? null : Number(p.cap),
    line_prefix: (p.line_prefix as string | null) ?? null,
    items: (p.items as string[] | null) ?? null,
    active: p.active !== false,
    sort_order: Number(p.sort_order ?? 0),
  }))

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
      <CommissionAdminPanel employees={employees} plans={plans} lines={lines} items={items} />
    </div>
  )
}
