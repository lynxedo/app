import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGrantedReportSlugs } from '@/lib/reports/access'
import { canSeeReport, canSeeOthersPerformance, getReport } from '@/lib/reports/registry'
import { loadReportLayoutInSync } from '@/lib/scoreboards/widgets/layouts'
import { hasReportLayout, reportLayoutSlug, widgetCatalog } from '@/lib/scoreboards/widgets/registry'
import { resolveBoard } from '@/lib/scoreboards/widgets/resolve'
import { resolveWindow, RANGE_OPTIONS } from '@/lib/scoreboards/widgets/windows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/* Data for one preset Report.
 *
 * Deliberately a separate route from the Scoreboards one rather than a `surface`
 * parameter threaded through it: the two have DIFFERENT permission models
 * (`can_access_reports` vs `can_access_scoreboards` + per-board grants), and
 * blending two gates into one function is how a gate ends up accidentally wide.
 * The expensive parts — layout seeding and the batched resolver — are shared.
 *
 * There is no PUT. A Report is a locked arrangement (§0.1); editing belongs to
 * Scoreboards. Anything that wants to change what shows here should copy it to a
 * Scoreboard instead, which is a future feature, not a missing one.
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

  const isAdmin = profile.role === 'admin'
  // Skipped for admins, who bypass grants anyway — this is the data route, so it
  // runs on every report load and shouldn't buy a query it cannot act on.
  const perms = {
    isAdmin,
    canAccessReports: profile.can_access_reports === true,
    allowedReportSlugs: isAdmin ? [] : await getGrantedReportSlugs(supabase, user.id),
  }

  const sp = new URL(request.url).searchParams
  const slug = sp.get('report') ?? ''
  const report = getReport(slug)
  // The real gate. The index page and the rail also filter, but those only decide
  // what is OFFERED — this decides what is SERVED, and it is the only one of the
  // three a hand-typed URL cannot walk past.
  if (!report || !canSeeReport(perms, slug)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!hasReportLayout(slug)) {
    return NextResponse.json({ error: 'This report has no layout yet' }, { status: 404 })
  }

  const win = resolveWindow(sp.get('range'), sp.get('start'), sp.get('end'))

  let layout
  try {
    layout = await loadReportLayoutInSync(profile.company_id, reportLayoutSlug(slug), user.id)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not load this report' }, { status: 500 })
  }
  if (!layout) return NextResponse.json({ error: 'This report has no layout yet' }, { status: 404 })

  // Service-role for the scoreboard_* RPCs — users can no longer call them
  // directly. The grant check above is the only gate, so it must stay above this.
  const resolved = await resolveBoard(
    {
      supabase,
      rpcClient: createAdminClient(),
      companyId: profile.company_id,
      viewerUserId: user.id,
      // People Performance narrows to the viewer's own row on this answer.
      canSeeOthersPerformance: canSeeOthersPerformance(perms),
    },
    layout,
    win,
  )

  const res = NextResponse.json({
    migrated: true,
    asOf: new Date().toISOString(),
    window: { ...win, range: sp.get('range') ?? 'ytd', options: RANGE_OPTIONS },
    layout: { ...layout, title: report.title },
    catalog: widgetCatalog(),
    canEdit: false,          // a Report is a locked arrangement
    ...resolved,
  })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
