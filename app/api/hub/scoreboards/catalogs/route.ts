import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGrantedReportSlugs } from '@/lib/reports/access'
import { canSeeReport, type ReportPerms } from '@/lib/reports/registry'
import type { CrewLaborRow, LeadItemsRow } from '@/lib/scoreboards/widgets/sources'
import type { CatalogName } from '@/lib/scoreboards/widgets/types'
// Shared so the picker, the filter and the chart all spell the no-credit bucket the
// same way — the filter matches on this exact string.
import { NO_SELLER, NO_TECH } from '@/lib/scoreboards/widgets/people-filter'
// Pure code→name map, shared with the Service Line report and the revenue trend, so
// "MO" never appears in the picker while "Mosquito" appears on the chart it filters.
import { lineName } from '@/lib/scoreboards/widgets/servicelines'

export const dynamic = 'force-dynamic'

/* Option lists for `catalog` config fields — the tenant's own data, for the widget
 * settings panel.
 *
 * ⚠ WHY THIS EXISTS: a `multi` config field carries a static option list declared in
 * code, and there is no static list of a customer's product names or staff. See the
 * `catalog` field type in lib/scoreboards/widgets/types.ts.
 *
 * ⚠⚠ EVERY NAME LIST IS DERIVED FROM THE SAME SOURCE THE CHART DRAWS FROM, never
 * rebuilt from the underlying tables — because the name expressions genuinely differ
 * and rebuilding them silently breaks matching. Measured: Crew & Labor composes
 * `coalesce(preferred_name, first_name) || ' ' || last_name` → "Angel Morin", while
 * People Performance composes `coalesce(hub display_name, preferred_name,
 * first_name)` → "Angel". A picker built from `employees.first_name || last_name`
 * would offer names that match one chart and NOTHING on the other, and a filter that
 * matches nothing renders an honest-looking zero. Deriving from the source makes the
 * offered names identical to the drawn ones by construction.
 *
 * ⚠⚠ GATED PER CATALOG, on the reports whose widgets actually use it — mirroring
 * `canUseWidget`'s "any report that places this widget" rule. A single sales-only
 * gate would have locked the crew picker away from someone holding Crew & Labor, and
 * a single permissive gate would have made Lead Tracker figures readable by anyone
 * with any report at all — the side door around `report_access` this file exists to
 * keep shut.
 */

const CATALOG_REPORTS: Record<CatalogName, string[]> = {
  // Lead Tracker data, with per-value counts → the Sales & Pipeline grant.
  lead_services: ['sales'],
  lead_salespeople: ['sales'],
  tracker_stages: ['sales'],
  // Roster names as Crew & Labor draws them.
  staff_people: ['crew'],
  // Jobber user names — the technician revenue trend (Crew) and quote reps (Sales).
  jobber_people: ['crew', 'sales'],
  /* The recurring-book pickers. Service lines are used by the book cards (Clients),
   * Ticket Size and the company revenue trend (Revenue) and the by-line chart
   * (Service Lines), so all three reports can offer them. Programs and add-ons are
   * only used by the book cards, so they stay narrower — the same
   * "any report that places this widget" rule `canUseWidget` applies. */
  service_lines: ['clients', 'revenue', 'service-lines'],
  recurring_programs: ['clients'],
  recurring_addons: ['clients'],
}

/** Every value, however old. The picker must offer a product sold once last year. */
const ALL_TIME_START = '1900-01-01'
const ALL_TIME_END = '2999-12-31'

type Option = { value: string; label: string; count: number | null }

function byCountThenName(a: [string, number], b: [string, number]): number {
  return b[1] - a[1] || a[0].localeCompare(b[0])
}

/** Real people first; a no-credit bucket last, since it is a gap rather than a colleague. */
function gapLast(gap: string) {
  return (a: Option, b: Option) => (a.value === gap ? 1 : b.value === gap ? -1 : 0)
}

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get('name') as CatalogName | null
  if (!name || !(name in CATALOG_REPORTS)) {
    return NextResponse.json({ error: 'Unknown catalog' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_access_reports, can_access_scoreboards')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const isAdmin = profile.role === 'admin'
  if (!isAdmin && !profile.can_access_scoreboards) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const perms: ReportPerms = {
    isAdmin,
    canAccessReports: profile.can_access_reports === true,
    // Skipped for admins, who bypass grants anyway — same as the widgets route.
    allowedReportSlugs: isAdmin ? [] : await getGrantedReportSlugs(supabase, user.id),
  }
  const needs = CATALOG_REPORTS[name]
  if (!needs.some(slug => canSeeReport(perms, slug))) {
    return NextResponse.json({ error: 'Forbidden', needs }, { status: 403 })
  }

  if (name === 'tracker_stages') {
    // RLS-scoped read through the caller's own client — this table is small and
    // already theirs to see.
    const { data, error } = await supabase
      .from('tracker_stages')
      .select('key, label, sort_order')
      .eq('company_id', profile.company_id)
      .order('sort_order', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({
      options: (data ?? []).map(s => ({ value: s.key, label: s.label || s.key, count: null })),
    })
  }

  const admin = createAdminClient()

  if (name === 'service_lines' || name === 'recurring_programs' || name === 'recurring_addons') {
    /* Three pickers, ONE book read.
     *
     * ⚠ The offered list is the UNION of what the tenant has DEFINED and what the
     * book currently uses, not just one of them. Counting only what is on the book
     * would hide a program nobody is enrolled on right now — precisely the thing you
     * might be about to start selling — and reading only the definitions would drop
     * a line the book uses but nobody has defined. Same rule as the tracked-item
     * picker, which offers a service sold once last year.
     *
     * ⚠ `dept_prefix` is the stored VALUE and the friendly name is only the LABEL,
     * because the widgets match on the code: the book rows carry `dept_prefix` and
     * the revenue trend's series key is the same code. Offering the display name
     * would produce a picker whose entries match nothing. */
    const [defsRes, bookRes] = await Promise.all([
      supabase
        .from('recurring_program_definitions')
        .select('dept_prefix, display_name, is_auxiliary')
        .eq('company_id', profile.company_id),
      admin.rpc('scoreboard_recurring_book', { p_company_id: profile.company_id }),
    ])
    if (defsRes.error) return NextResponse.json({ error: defsRes.error.message }, { status: 500 })
    if (bookRes.error) return NextResponse.json({ error: bookRes.error.message }, { status: 500 })

    type BookRow = { dept_prefix: string | null; display_name: string | null; addon_names: string[] | null }
    const bookRows = (bookRes.data ?? []) as BookRow[]
    const defs = defsRes.data ?? []
    const counts = new Map<string, number>()
    const bump = (k: string | null | undefined) => {
      const v = k?.trim()
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
    }

    if (name === 'service_lines') {
      for (const r of bookRows) bump(r.dept_prefix)
      const all = new Set<string>([
        ...defs.map(d => d.dept_prefix?.trim()).filter((v): v is string => !!v),
        ...counts.keys(),
      ])
      return NextResponse.json({
        options: [...all].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b))
          // Label carries the friendly name AND the code, so somebody who thinks in
          // "IR" and somebody who thinks in "Irrigation" both find the row.
          .map(code => ({ value: code, label: `${lineName(code)} (${code})`, count: counts.get(code) ?? 0 })),
      })
    }

    if (name === 'recurring_addons') {
      for (const r of bookRows) for (const a of r.addon_names ?? []) bump(a)
      const all = new Set<string>([
        ...defs.filter(d => d.is_auxiliary).map(d => d.display_name?.trim()).filter((v): v is string => !!v),
        ...counts.keys(),
      ])
      return NextResponse.json({
        options: [...all].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b))
          .map(v => ({ value: v, label: v, count: counts.get(v) ?? 0 })),
      })
    }

    for (const r of bookRows) bump(r.display_name)
    const all = new Set<string>([
      ...defs.filter(d => !d.is_auxiliary).map(d => d.display_name?.trim()).filter((v): v is string => !!v),
      ...counts.keys(),
    ])
    return NextResponse.json({
      options: [...all].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b))
        .map(v => ({ value: v, label: v, count: counts.get(v) ?? 0 })),
    })
  }

  if (name === 'staff_people') {
    /* From `scoreboard_crew_labor` so the names are byte-identical to the ones the
     * crew charts draw. The window is unbounded; the function clamps itself to where
     * timeclock data exists, so this returns everyone who has ever clocked in. */
    const { data, error } = await admin.rpc('scoreboard_crew_labor', {
      p_company_id: profile.company_id,
      p_start: ALL_TIME_START,
      p_end: ALL_TIME_END,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const row = data as CrewLaborRow | null
    const seen = new Map<string, number>()
    for (const p of row?.people ?? []) {
      if (p.name) seen.set(p.name, Math.round(p.hours ?? 0))
    }
    return NextResponse.json({
      // Hours as the count, so a picker entry reads "Angel Morin 421" and a
      // long-departed name with 2 hours is visibly not the person you meant.
      options: [...seen.entries()].sort(byCountThenName).map(([value, count]) => ({ value, label: value, count })),
    })
  }

  if (name === 'jobber_people') {
    /* Jobber user names. Both consumers (the per-technician revenue trend and the
     * quote-rep breakdown) label people with `jobber_users.name` verbatim, so reading
     * the column cannot drift from what they draw — unlike the roster, where two
     * functions compose the name two different ways.
     *
     * ⚠ The caller's OWN client: `jobber_users` is RLS-scoped to the company and
     * readable by any member, so this widens nothing. */
    const { data, error } = await supabase
      .from('jobber_users')
      .select('name, is_active')
      .eq('company_id', profile.company_id)
      .not('name', 'is', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const active = (data ?? []).filter(u => u.is_active).map(u => u.name as string)
    const inactive = (data ?? []).filter(u => !u.is_active).map(u => u.name as string)
    const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b))
    return NextResponse.json({
      // Current staff first; former staff still offered, because a past period
      // legitimately contains their work. 9 of Heroes' 24 are deactivated.
      options: [
        ...uniq(active).map(v => ({ value: v, label: v, count: null })),
        ...uniq(inactive).map(v => ({ value: v, label: `${v} (former)`, count: null })),
        // Both consumers have work with nobody credited — unassigned visits and
        // quotes with no rep — so the gap is tickable rather than invisible.
        { value: NO_TECH, label: NO_TECH, count: null },
      ],
    })
  }

  /* lead_services and lead_salespeople — both from the tracked-item function over an
   * unbounded window with no stage filter, so the picker offers exactly the values
   * the widget can count and nothing else.
   *
   * Basis 'created' on purpose: every lead has a creation date, while only leads that
   * reached a sold stage have a sold date, so the sold basis would hide any service
   * nobody has bought yet — precisely the thing you might want to start tracking. */
  const { data, error } = await admin.rpc('scoreboard_lead_items', {
    p_company_id: profile.company_id,
    p_start: ALL_TIME_START,
    p_end: ALL_TIME_END,
    p_basis: 'created',
    p_stages: null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const row = data as LeadItemsRow | null
  const totals = new Map<string, number>()

  if (name === 'lead_salespeople') {
    for (const r of row?.rows ?? []) {
      const who = r.salesperson?.trim() || NO_SELLER
      totals.set(who, (totals.get(who) ?? 0) + r.leads)
    }
    return NextResponse.json({
      options: [...totals.entries()]
        .sort(byCountThenName)
        .map(([value, count]) => ({ value, label: value, count }))
        .sort(gapLast(NO_SELLER)),
    })
  }

  for (const r of row?.rows ?? []) totals.set(r.value, (totals.get(r.value) ?? 0) + r.leads)
  return NextResponse.json({
    options: [...totals.entries()].sort(byCountThenName).map(([value, count]) => ({ value, label: value, count })),
  })
}
