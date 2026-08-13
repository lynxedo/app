/* The Reports catalog.
 *
 * A **Report** is a preset, locked arrangement of widgets we ship — the standard
 * stuff that should work out of the box with no setup. A **Scoreboard** is an
 * arrangement the user assembles from the same library (REPORTS_PRD.md §0.1).
 * One widget library, two consumers.
 *
 * Access is the two-layer model from §12, and BOTH layers now exist:
 *   1. `can_access_reports` (Admin → People) opens the section at all.
 *   2. `report_access` rows (Admin → Reports) decide which reports inside it.
 * Default is nothing-until-granted: the section flag alone shows an empty index.
 * Admins (role = 'admin') see every report regardless of grants.
 *
 * ⚠ Why layer 2 was worth building rather than leaving the section flag to do both
 * jobs: the reports are not equally sensitive. Crew & Labor shows what individual
 * people earn per hour, and Service Line Profitability shows wage totals — so
 * "can open Reports" was granting the payroll-shaped pages to anyone who needed
 * Revenue. §12 always said these are separately gated; until now they weren't.
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
  /**
   * A report that carries its OWN gate instead of the normal grant model.
   *
   * Only Call Coaching does this, and it is not a style choice: coaching is
   * per-rep grade data gated on `can_access_coaching` ALONE, with **no admin
   * bypass** — the only screen in the product like that. Routing it through
   * `report_access` would have quietly given every admin a screen that has
   * always excluded them.
   */
  gate?: 'coaching'
  /**
   * Renders its own component rather than a widget layout. Call Coaching only:
   * §9.1.5 puts it permanently outside the widget library, because its metrics
   * are individual grades and a composable board could put them in front of the
   * wrong person. Moving it into Reports moves WHERE IT LIVES, not what it is.
   */
  legacyView?: boolean
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
  {
    slug: 'people',
    title: 'People Performance',
    subtitle: 'Your own scorecard — what you sold, what you produced, and how your department is doing',
    section: 'People',
    icon: '🧑\u200d🔧',
    prd: '§8.7',
  },
  {
    slug: 'coaching',
    title: 'Call Coaching',
    subtitle: 'Call grades, weak spots, must-listen queue & rep performance',
    section: 'People',
    icon: '🎧',
    prd: '§9.1.5',
    gate: 'coaching',
    legacyView: true,
  },
]

export function getReport(slug: string): ReportMeta | null {
  return REPORTS.find(r => r.slug === slug) ?? null
}

export type ReportPerms = {
  isAdmin: boolean
  canAccessReports: boolean
  /**
   * Report slugs this user is explicitly granted (`report_access`). Ignored for
   * admins, who see everything.
   *
   * ⚠ OPTIONAL, and that is a deliberate risk accepted with a mitigation rather
   * than an oversight. An omitted permission field defaults to the LOCKED state
   * here (undefined → no grants → no reports), which fails CLOSED. That is the
   * safe direction, and the opposite of the Aug-11 rail bug where an optional
   * `canAccessReports` prop defaulted to false and silently hid a shipped
   * feature — absent looked exactly like never-shipped. Here a forgotten wire-up
   * costs a user their reports, which they will report immediately, instead of
   * quietly handing them wage data.
   */
  allowedReportSlugs?: string[]
  /**
   * Call Coaching's own flag. ⚠ Admins do NOT bypass it — it is the one gate in
   * the product that excludes them, because the screen shows individual reps'
   * grades. Preserved exactly as it was when coaching lived in Scoreboards.
   */
  canAccessCoaching?: boolean
}

/** Whether the Reports section is visible at all. */
export function canSeeReports(perms: ReportPerms): boolean {
  return perms.isAdmin || perms.canAccessReports
}

/**
 * Whether the section should open for this user — i.e. is there anything inside.
 *
 * Distinct from `canSeeReports`: coaching carries its own flag, so someone can
 * have a report to read without holding `can_access_reports` at all, and the
 * section gate alone would bounce them off a page they have a row on.
 */
export function canOpenReportsSection(perms: ReportPerms): boolean {
  return canSeeReports(perms) || reportsForUser(perms).length > 0
}

/**
 * Whether ONE report is visible — layer 2 of §12.
 *
 * Order matters: the section gate is checked first, so a grant row can never let
 * someone into Reports who lacks `can_access_reports`. A stale grant left behind
 * after the section flag is revoked therefore grants nothing.
 */
export function canSeeReport(perms: ReportPerms, slug: string): boolean {
  // Call Coaching answers to its own flag and NOTHING else — not the section
  // flag, not report_access, and explicitly not the admin bypass. Checked first
  // so none of the rules below can widen it. Moving it out of Scoreboards must
  // not change who can read it, and this line is what guarantees that.
  if (getReport(slug)?.gate === 'coaching') return perms.canAccessCoaching === true
  if (!canSeeReports(perms)) return false
  if (perms.isAdmin) return true
  return (perms.allowedReportSlugs ?? []).includes(slug)
}

/**
 * The grant that upgrades People Performance from "your own card" to "everyone".
 *
 * Held as a SECOND grant row rather than a flag on the first, so the two are
 * independently toggleable in Admin → Reports: `people` opens the report on your
 * own numbers, `people:team` adds everyone else's rows. Not a report in its own
 * right, so it never appears in REPORTS or on the index.
 */
export const PEOPLE_TEAM_SLUG = 'people:team'

/**
 * Whether this user may see OTHER people on People Performance.
 *
 * ⚠ Not a display concern. The source narrows the row set server-side on this
 * answer, so a wrong `false` costs a manager the team view and a wrong `true`
 * shows one employee another's numbers. Requires the report itself first: a
 * team-view row without access to the report grants nothing.
 */
export function canSeeOthersPerformance(perms: ReportPerms): boolean {
  if (!canSeeReport(perms, 'people')) return false
  if (perms.isAdmin) return true
  return (perms.allowedReportSlugs ?? []).includes(PEOPLE_TEAM_SLUG)
}

export function reportsForUser(perms: ReportPerms): ReportMeta[] {
  // ⚠ Do NOT re-add a `canSeeReports(perms) ? ... : []` wrapper here. canSeeReport
  // already applies the section gate to every report that answers to it, and the
  // wrapper hid the two that do not — coaching (own flag) and People (own
  // scorecard) — from exactly the people entitled to them.
  return REPORTS.filter(r => canSeeReport(perms, r.slug))
}

/** Index-page grouping, in a deliberate reading order rather than alphabetical. */
export const SECTION_ORDER: ReportMeta['section'][] = ['Overview', 'Money', 'Customers', 'Sales', 'Operations', 'People']
