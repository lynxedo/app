/* The Reports catalog.
 *
 * A **Report** is a preset, locked arrangement of widgets we ship — the standard
 * stuff that should work out of the box with no setup. A **Scoreboard** is an
 * arrangement the user assembles from the same library (REPORTS_PRD.md §0.1).
 * One widget library, two consumers.
 *
 * Access is the two-layer model from §12: `can_access_reports` opens the section,
 * and per-report grants decide which pages inside it. ⚠ The per-report grant layer
 * is NOT built yet — today the section flag (plus admin) is the whole gate, which
 * is deliberately no looser than the `role = 'admin'` check it replaces.
 */

export type ReportMeta = {
  /** URL slug. The saved layout lives under `report:<slug>`. */
  slug: string
  title: string
  subtitle: string
  /** Groups the index page. */
  section: 'Overview' | 'Money' | 'Customers' | 'Sales' | 'Operations' | 'People'
  icon: string
  /** PRD section this page implements, so the doc and the code stay findable. */
  prd: string
  /**
   * Window this report opens on. Defaults to year-to-date like every board.
   *
   * ⚠ Home overrides it to `this_month`, and the reason is a real trap rather than
   * a preference: Home's tiles compare against the immediately preceding window,
   * and year-to-date's predecessor reaches back past the invoice mirror's floor —
   * so every delta on the page would correctly, but uselessly, say "no comparison".
   */
  defaultRange?: 'ytd' | 'this_month' | 'last_month' | 'this_quarter' | 'last_12' | 'last_year'
}

export const REPORTS: ReportMeta[] = [
  {
    slug: 'home',
    title: 'Home',
    subtitle: 'The ten-second read on the whole business, and what needs doing today',
    section: 'Overview',
    icon: '🏡',
    prd: '§8.1',
    defaultRange: 'this_month',
  },
  {
    slug: 'revenue',
    title: 'Revenue & Invoicing',
    subtitle: 'What you billed, what came in, and exactly who still owes you money',
    section: 'Money',
    icon: '💵',
    prd: '§8.3',
  },
  {
    slug: 'clients',
    title: 'Clients',
    subtitle: 'Is the customer base growing, who spends the most, and where they are',
    section: 'Customers',
    icon: '🏠',
    prd: '§8.4',
  },
  {
    slug: 'communications',
    title: 'Communications',
    subtitle: 'Are you answering the phone and following up? Missed calls are missed revenue',
    section: 'Operations',
    icon: '📞',
    prd: '§8.10',
  },
  {
    slug: 'sales',
    title: 'Sales & Pipeline',
    subtitle: 'Are you winning work, and where is the funnel leaking?',
    section: 'Sales',
    icon: '🎯',
    prd: '§8.2',
  },
  {
    slug: 'service-lines',
    title: 'Service Line Profitability',
    subtitle: 'Which parts of the business pay for the crew time they take',
    section: 'Money',
    icon: '📐',
    prd: '§8.8',
  },
  {
    slug: 'crew',
    title: 'Crew & Labor Efficiency',
    subtitle: 'What every clocked hour brings in — revenue against the timeclock, per person',
    section: 'Operations',
    icon: '👷',
    prd: '§8.6',
  },
  {
    slug: 'retention',
    title: 'Retention & Churn',
    subtitle: 'What share of the recurring book you keep, why customers leave, and how much it costs',
    section: 'Customers',
    icon: '🔄',
    prd: '§8.5',
  },
]

export function getReport(slug: string): ReportMeta | null {
  return REPORTS.find(r => r.slug === slug) ?? null
}

export type ReportPerms = {
  isAdmin: boolean
  canAccessReports: boolean
}

/** Whether the Reports section is visible at all. */
export function canSeeReports(perms: ReportPerms): boolean {
  return perms.isAdmin || perms.canAccessReports
}

/**
 * Whether one report is visible. Per-report grants land here when they're built;
 * until then this is the section gate, so adding the layer later can only ever
 * narrow access, never widen it by surprise.
 */
export function canSeeReport(perms: ReportPerms, _slug: string): boolean {
  return canSeeReports(perms)
}

export function reportsForUser(perms: ReportPerms): ReportMeta[] {
  return canSeeReports(perms) ? REPORTS.filter(r => canSeeReport(perms, r.slug)) : []
}

/** Index-page grouping, in a deliberate reading order rather than alphabetical. */
export const SECTION_ORDER: ReportMeta['section'][] = ['Overview', 'Money', 'Customers', 'Sales', 'Operations', 'People']
