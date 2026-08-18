import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGrantedReportSlugs } from '@/lib/reports/access'
import { canSeeReport, getReport } from '@/lib/reports/registry'
import { getDrilldown, parseDrillPeople } from '@/lib/reports/drilldowns'
import { toCsv, csvFilename } from '@/lib/reports/drilldown-csv'
import { resolveWindow } from '@/lib/scoreboards/widgets/windows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/* Download the rows behind a number as a spreadsheet.
 *
 * Runs the SAME drill-down function the on-screen table uses, so the file and the
 * page can never disagree — the alternative (a second query written to match) is
 * exactly how an export drifts from what someone just looked at.
 *
 * Gated identically to the report itself. An export endpoint is the easiest place
 * to accidentally open a wider door than the page it serves.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_access_reports')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const sp = new URL(request.url).searchParams
  const reportSlug = sp.get('report') ?? ''
  const drillKey = sp.get('drill') ?? ''

  const report = getReport(reportSlug)
  const isAdmin = profile.role === 'admin'
  const perms = {
    isAdmin,
    canAccessReports: profile.can_access_reports === true,
    allowedReportSlugs: isAdmin ? [] : await getGrantedReportSlugs(supabase, user.id),
  }
  // Per-report grants apply to the EXPORT too. A download is the same data in a
  // file, so gating the page and not the file would leave the whole point of the
  // gate one URL away — and this is the route that hands over wage rows in bulk.
  if (!report || !canSeeReport(perms, reportSlug)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const drill = getDrilldown(drillKey)
  if (!drill || !drill.reports.includes(reportSlug)) {
    return NextResponse.json({ error: 'Unknown export' }, { status: 404 })
  }

  const win = resolveWindow(sp.get('range') ?? report.defaultRange, sp.get('start'), sp.get('end'))

  let rows
  try {
    // ⚠ Same filter as the page. A download that quietly contains rows the page did
    // not show is the version of this bug nobody notices until it is in a spreadsheet.
    rows = await drill.run({
      supabase, rpcClient: createAdminClient(), companyId: profile.company_id, win,
      people: parseDrillPeople(sp.get('people') ?? undefined),
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not build this export' },
      { status: 500 },
    )
  }

  return new NextResponse(toCsv(drill.columns, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename(reportSlug, drillKey)}"`,
      // Customer names and balances — never let a proxy hold a copy.
      'Cache-Control': 'private, no-store',
    },
  })
}
