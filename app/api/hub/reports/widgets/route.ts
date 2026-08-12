import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canSeeReport, getReport } from '@/lib/reports/registry'
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

  const perms = { isAdmin: profile.role === 'admin', canAccessReports: profile.can_access_reports === true }

  const sp = new URL(request.url).searchParams
  const slug = sp.get('report') ?? ''
  const report = getReport(slug)
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

  const resolved = await resolveBoard({ supabase, companyId: profile.company_id }, layout, win)

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
