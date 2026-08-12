import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBusinessProfile } from '@/lib/business-profile'
import { getGrantedReportSlugs } from '@/lib/reports/access'
import { canSeeReport, getReport } from '@/lib/reports/registry'
import { hasReportLayout } from '@/lib/scoreboards/widgets/registry'
import WidgetBoardView from '@/components/hub/scoreboards/widgets/WidgetBoardView'
import Scoreboard6View from '@/app/hub/scoreboards/[slug]/Scoreboard6View'

export const metadata = { title: 'Report' }
export const dynamic = 'force-dynamic'

/* One preset Report, rendered from a locked widget layout.
 *
 * ⚠ This dynamic segment sits alongside the two STATIC legacy report routes
 * (/hub/reports/visits and /hub/reports/customers). Next.js prefers a static
 * segment over a dynamic one, so those keep working untouched — this only picks up
 * slugs the registry knows about, and 404s otherwise.
 */
export default async function ReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const report = getReport(slug)
  if (!report) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_access_reports, can_access_coaching, company_id')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'
  const perms = {
    isAdmin,
    canAccessReports: profile?.can_access_reports === true,
    canAccessCoaching: profile?.can_access_coaching === true,
    allowedReportSlugs: isAdmin ? [] : await getGrantedReportSlugs(supabase, user.id),
  }
  // Redirect rather than 404: an ungranted report is a real page they simply
  // aren't cleared for, and the data route returns 403 regardless, so nothing
  // here is the last line of defence.
  if (!canSeeReport(perms, slug)) redirect('/hub')

  // Call Coaching renders its own screen, unchanged from when it lived in
  // Scoreboards. It has no widget layout and is never getting one (§9.1.5): its
  // metrics are individual reps' grades, and putting them in the shared widget
  // library would let someone drop them onto a board another person can open.
  // Returned before the layout check, which would otherwise 404 it.
  if (report.legacyView) {
    return <Scoreboard6View meta={{ slug: report.slug, title: report.title, subtitle: report.subtitle, badge: 'Coaching' }} />
  }

  if (!hasReportLayout(slug)) notFound()

  const admin = createAdminClient()
  const { businessName } = await getBusinessProfile(admin, profile?.company_id ?? null)

  return (
    <WidgetBoardView
      meta={{ slug: report.slug, title: report.title, badge: report.section }}
      businessName={businessName}
      surface={{ kind: 'report', slug: report.slug }}
      defaultRange={report.defaultRange}
    />
  )
}
