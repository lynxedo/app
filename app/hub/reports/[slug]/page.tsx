import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBusinessProfile } from '@/lib/business-profile'
import { canSeeReport, getReport } from '@/lib/reports/registry'
import { hasReportLayout } from '@/lib/scoreboards/widgets/registry'
import WidgetBoardView from '@/components/hub/scoreboards/widgets/WidgetBoardView'

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
    .select('role, can_access_reports, company_id')
    .eq('id', user.id)
    .single()

  const perms = {
    isAdmin: profile?.role === 'admin',
    canAccessReports: profile?.can_access_reports === true,
  }
  if (!canSeeReport(perms, slug)) redirect('/hub')
  if (!hasReportLayout(slug)) notFound()

  const admin = createAdminClient()
  const { businessName } = await getBusinessProfile(admin, profile?.company_id ?? null)

  return (
    <WidgetBoardView
      meta={{ slug: report.slug, title: report.title, badge: report.section }}
      businessName={businessName}
      surface={{ kind: 'report', slug: report.slug }}
    />
  )
}
