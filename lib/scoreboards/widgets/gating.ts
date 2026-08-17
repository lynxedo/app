/* Which widgets a person may put on a Scoreboard — and see on one.
 *
 * Ben's rule for user-built Scoreboards: anyone can build a board and share it,
 * but the widgets available to them are decided by the REPORTS they have access
 * to. A widget is a view onto a report's data, so entitlement follows the data,
 * not the container.
 *
 * ⚠⚠ THE PART THAT MATTERS: the same rule is applied to the VIEWER, not just the
 * builder. Gating only the picker would make a shared board a side door around
 * `report_access` — build a board with the $/labour-hour card, share it with a
 * technician, and they read four colleagues' wages. That is precisely the
 * exposure the Aug-12 session found and closed at the RPC layer, and per-report
 * grants exist because Crew & Labor and Service Lines are payroll-shaped pages.
 * So `canUseWidget` is asked twice — once about the builder when offering the
 * library, once about each viewer when resolving the board — and a widget the
 * viewer isn't entitled to is never fetched, let alone rendered.
 *
 * ⚠ Scope: this applies to CUSTOM boards only. The eight boards we ship keep
 * their existing per-board grant (`scoreboard_board_access`) and the preset
 * Reports keep theirs (`report_access` on the report itself). Extending the
 * widget gate to Board 8 would REVOKE marketing cards from people who can see
 * that board today — a silent regression dressed up as a security fix.
 */

import type { ReportPerms } from '@/lib/reports/registry'
import { canSeeReport } from '@/lib/reports/registry'

/**
 * Widget group → the Report that owns that data.
 *
 * The group is already declared on every widget (it groups the picker), so this
 * is one small map rather than a `report:` field repeated 114 times. Completeness
 * is checked, not assumed — see `unmappedWidgetGroups` below, which is asserted
 * at import in lib/scoreboards/widgets/layouts.ts.
 *
 * ⚠ 'Quotes' maps to 'sales' because the quote widgets ARE the second half of the
 * Sales & Pipeline report (REPORT_PRESETS['report:sales'] concatenates them).
 * There is no Quotes report to grant.
 */
export const WIDGET_GROUP_REPORT: Record<string, string> = {
  'Home': 'home',
  'Revenue': 'revenue',
  'Clients': 'clients',
  'Communications': 'communications',
  'Sales': 'sales',
  'Quotes': 'sales',
  'Service Lines': 'service-lines',
  'Crew & Labor': 'crew',
  'Retention': 'retention',
  'Marketing': 'marketing',
  'People': 'people',
  'Goals': 'goals',
}

/**
 * Every report a widget appears on: its own group's report, plus any preset that
 * places it.
 *
 * The union is the honest rule — "you may use a widget you can already read
 * somewhere". Home lifts two cards straight out of §8.3 Revenue and the Marketing
 * report carries the Clients ZIP map, so a group-only test would tell someone
 * granted Home that they cannot use a card sitting on their own Home page.
 */
export function widgetReportSlugs(
  type: string,
  group: string,
  presets: Record<string, { widgets: { type: string }[] }>,
): string[] {
  const out = new Set<string>()
  const own = WIDGET_GROUP_REPORT[group]
  if (own) out.add(own)
  for (const [layoutSlug, preset] of Object.entries(presets)) {
    if (!layoutSlug.startsWith('report:')) continue
    if (preset.widgets.some(w => w.type === type)) out.add(layoutSlug.slice('report:'.length))
  }
  return [...out]
}

/** Groups in the registry with no report mapped. Non-empty = a widget nobody can use. */
export function unmappedWidgetGroups(groups: string[]): string[] {
  return [...new Set(groups)].filter(g => !(g in WIDGET_GROUP_REPORT))
}

/**
 * May this person use / see this widget?
 *
 * `reports` is the list from `widgetReportSlugs`, carried on the catalog entry so
 * the browser can grey out what it can't offer without shipping the map.
 *
 * ⚠ Fails CLOSED in every uncertain case: a widget whose group is unmapped, or
 * one that belongs to no report at all, is unusable rather than universal. An
 * unusable widget is a bug someone reports in a minute; a universal one is a
 * quiet hole. Admins bypass, exactly as they do for reports themselves.
 */
export function canUseWidget(perms: ReportPerms, reports: string[]): boolean {
  if (perms.isAdmin) return true
  if (!reports.length) return false
  return reports.some(slug => canSeeReport(perms, slug))
}

/**
 * Report titles for a "you need X to see this" message, resolved by the caller so
 * this module stays free of the REPORTS array (and therefore cheap to import in a
 * client component).
 */
export function firstReportSlug(reports: string[]): string | null {
  return reports[0] ?? null
}
