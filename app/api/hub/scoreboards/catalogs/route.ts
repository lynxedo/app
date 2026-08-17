import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGrantedReportSlugs } from '@/lib/reports/access'
import { canSeeReport, type ReportPerms } from '@/lib/reports/registry'
import type { LeadItemsRow } from '@/lib/scoreboards/widgets/sources'
import type { CatalogName } from '@/lib/scoreboards/widgets/types'

export const dynamic = 'force-dynamic'

/* Option lists for `catalog` config fields — the tenant's own data, for the widget
 * settings panel.
 *
 * GET ?name=lead_services   Service values from the Lead Tracker, with lead counts
 * GET ?name=tracker_stages  This company's Tracker stages, in board order
 *
 * ⚠ WHY THIS EXISTS AT ALL: a `multi` config field carries a static option list
 * declared in code, and there is no static list of a customer's product names. See
 * the `catalog` field type in lib/scoreboards/widgets/types.ts.
 *
 * ⚠⚠ GATED ON THE SALES REPORT, not merely on having Scoreboards. These values are
 * Lead Tracker data — what people asked for, and how often — so handing them to
 * anyone who can open a Scoreboard would be a side door around `report_access`,
 * which is the exact hole closed at the RPC layer on 2026-08-12. The gate matches
 * the one the tracked-item widgets themselves answer to (WIDGET_GROUP_REPORT).
 *
 * ⚠ Counts ride along with each value deliberately. They are how somebody spots
 * that "IR- Rachio" and "IR - Rachio" are one product typed two ways — the picker
 * showing 9 beside one and 4 beside the other is what makes the pair visible.
 */

const SALES_REPORT = 'sales'

/** Every value, however old. The picker must offer a product sold once last year. */
const ALL_TIME_START = '1900-01-01'
const ALL_TIME_END = '2999-12-31'

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get('name') as CatalogName | null
  if (name !== 'lead_services' && name !== 'tracker_stages') {
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
  if (!canSeeReport(perms, SALES_REPORT)) {
    return NextResponse.json({ error: 'Forbidden', needs: SALES_REPORT }, { status: 403 })
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

  /* Reuses the gated tracked-item function over an unbounded window with no stage
   * filter, rather than adding a second query that could drift from it: the picker
   * then offers exactly the values the widget can count, and nothing else.
   *
   * Basis 'created' on purpose — every lead has a creation date, while only leads
   * that reached a sold stage have a sold date, so the sold basis would hide any
   * service nobody has bought yet. A product you have never sold is precisely one
   * you might want to start tracking. */
  const admin = createAdminClient()
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
  for (const r of row?.rows ?? []) totals.set(r.value, (totals.get(r.value) ?? 0) + r.leads)

  return NextResponse.json({
    options: [...totals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count })),
  })
}
