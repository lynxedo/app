import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { listCatalog, listTenants, getBillingMode } from '@/lib/billing/catalog'
import PlatformConsole from './PlatformConsole'

export const metadata = { title: 'Platform Admin' }

// The platform super-admin console (Track 6): the cross-company "God-mode" for the
// pricing catalog + per-tenant billing snapshot. Gated on
// user_profiles.is_platform_admin — NOT `role` (that only governs a single tenant's
// own admin area). Middleware already guards this route; this re-checks the flag as
// defense-in-depth, mirroring the beta admin page.
//
// billing_catalog has RLS enabled with NO policies, so the data below MUST be read
// with the service-role admin client (a user-scoped client would return nothing).
export default async function PlatformAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_platform_admin) redirect('/hub/home')

  const admin = createAdminClient()
  const mode = getBillingMode()
  const [features, tenants] = await Promise.all([
    listCatalog(admin),
    listTenants(admin, mode),
  ])

  return <PlatformConsole features={features} tenants={tenants} mode={mode} />
}
