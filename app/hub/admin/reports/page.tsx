import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { REPORTS, PEOPLE_TEAM_SLUG } from '@/lib/reports/registry'
import ReportAccessPanel from './ReportAccessPanel'
import GoalsAdminPanel from './GoalsAdminPanel'
import CommissionAdminPanel from './CommissionAdminPanel'
import RecurringProgramsPanel, { type ProgramRow, type UnmappedRow } from './RecurringProgramsPanel'
import MarketingSpendPanel, { type SpendRow } from './MarketingSpendPanel'
import { GOAL_METRICS, GOAL_GRAINS } from '@/lib/reports/goals'
import {
  PLAN_DEFAULTS, normalizeTiers,
  type CommissionBasis, type CommissionPeriod, type RateKind, type TierMode,
} from '@/lib/reports/commission'

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
    .select('id, metric, grain, period_start, period_end, target, employee_id, repeats')
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
  const [{ data: planRows }, { data: empRows }, { data: defRows }, itemsRes,
         cadenceRes, unmappedRes] = await Promise.all([
    admin
      .from('commission_plans')
      .select('id, employee_id, label, basis, rate_kind, rate, tiers, threshold, cap, line_prefix, items, active, sort_order, period, tier_mode, verify_source, min_price, exclude_renewals, effective_from, effective_to')
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
      .select('id, line_item_name, dept_prefix')
      .eq('company_id', company),
    admin.rpc('scoreboard_lead_items', {
      p_company_id: company,
      p_start: '1900-01-01',
      p_end: '2999-12-31',
      p_basis: 'created',
      p_stages: null,
    }),
    // The recurring programs editor. `_cadence_check` puts what each program DECLARES
    // next to what its jobs are actually scheduled for, which is the whole point of the
    // screen: on 2026-08-17 two cadences were wrong in opposite directions and finding
    // either needed a database session. `_unmapped_line_items` is the discovery half —
    // items sitting on recurring jobs that nothing counts.
    admin.rpc('recurring_program_cadence_check', { p_company_id: company }),
    admin.rpc('recurring_unmapped_line_items', { p_company_id: company }),
  ])

  /* Marketing spend, and the channel list it must be filed against.
   *
   * ⚠ Read with the service-role client because `marketing_spend` has RLS on with no
   * policies — what the company pays for leads is not readable off the REST API by
   * every Hub user. See the migration.
   */
  const [{ data: spendRows }, { data: masterRows }] = await Promise.all([
    admin
      .from('marketing_spend')
      .select('id, source, period_start, amount, notes')
      .eq('company_id', company)
      .order('period_start', { ascending: false })
      .limit(500),
    admin
      .from('lead_sources_master')
      .select('master_source')
      .eq('company_id', company)
      .order('master_source', { ascending: true }),
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
    /* ⚠ Each one falls back to today's behaviour, matching `toPlan` in the widget.
     * The editor and the card must read a pre-migration row identically or the rule
     * sentence on this screen would describe something the card does not pay. */
    period: (p.period as CommissionPeriod | null) ?? PLAN_DEFAULTS.period,
    tier_mode: (p.tier_mode as TierMode | null) ?? PLAN_DEFAULTS.tier_mode,
    verify_source: (p.verify_source as 'invoice' | null) ?? null,
    min_price: p.min_price == null ? null : Number(p.min_price),
    exclude_renewals: p.exclude_renewals === true,
    effective_from: (p.effective_from as string | null) ?? null,
    effective_to: (p.effective_to as string | null) ?? null,
  }))

  /* The cadence RPC is keyed on line_item_name (that is the table's natural key), but
   * edit and delete need the row id — mapped from the read that already happened above
   * rather than a second round trip. */
  const defById = new Map(
    (defRows ?? []).map(d => [d.line_item_name as string, d.id as string])
  )
  const programs: ProgramRow[] = ((cadenceRes.data ?? []) as Record<string, unknown>[])
    .map(r => ({
      id: defById.get(String(r.line_item_name)) ?? String(r.line_item_name),
      line_item_name: String(r.line_item_name),
      display_name: String(r.display_name),
      dept_prefix: String(r.dept_prefix ?? ''),
      is_auxiliary: r.is_auxiliary === true,
      rounds_per_year: r.declared_per_year == null ? null : Number(r.declared_per_year),
      live_jobs: Number(r.live_jobs ?? 0),
      measured_typical: r.measured_rounds_typical == null ? null : Number(r.measured_rounds_typical),
      measured_min: r.measured_rounds_min == null ? null : Number(r.measured_rounds_min),
      measured_max: r.measured_rounds_max == null ? null : Number(r.measured_rounds_max),
    }))
  const unmapped: UnmappedRow[] = ((unmappedRes.data ?? []) as Record<string, unknown>[])
    .map(r => ({
      line_item_name: String(r.line_item_name),
      live_jobs: Number(r.live_jobs ?? 0),
      per_visit_total: Number(r.per_visit_total ?? 0),
      guessed_prefix: r.guessed_prefix == null ? null : String(r.guessed_prefix),
    }))

  return (
    <div className="space-y-14">
      <ReportAccessPanel reports={reports} users={users} initialAccess={access} teamSlug={PEOPLE_TEAM_SLUG} />
      <GoalsAdminPanel
        metrics={GOAL_METRICS.map(m => ({
          key: m.key, label: m.label, group: m.group, format: m.format, help: m.help,
          direction: m.direction, grains: [...(m.grains ?? GOAL_GRAINS)],
          perPerson: m.perPerson, perPersonBlocker: m.perPersonBlocker ?? null,
          perPersonCaution: m.perPersonCaution ?? null,
        }))}
        goals={(goalRows ?? []).map(g => ({
          id: g.id as string,
          metric: g.metric as string,
          grain: g.grain as 'month' | 'quarter' | 'year',
          period_start: g.period_start as string,
          period_end: g.period_end as string,
          target: Number(g.target),
          employee_id: (g.employee_id as string | null) ?? null,
          repeats: g.repeats === true,
          // Resolved here from the same roster the picker offers, so the list and
          // the picker cannot disagree about what somebody is called.
          person_name: g.employee_id ? (empName.get(g.employee_id as string) ?? null) : null,
        }))}
        employees={employees}
      />
      <CommissionAdminPanel employees={employees} plans={plans} lines={lines} items={items} />
      <MarketingSpendPanel
        sources={[...new Set((masterRows ?? []).map(r => String(r.master_source)).filter(Boolean))]}
        rows={(spendRows ?? []).map(r => ({
          id: r.id as string,
          source: r.source as string,
          period_start: r.period_start as string,
          amount: Number(r.amount),
          notes: (r.notes as string | null) ?? null,
        })) as SpendRow[]}
      />
      <RecurringProgramsPanel programs={programs} unmapped={unmapped} lines={lines} />
    </div>
  )
}
