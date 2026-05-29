import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import MarketingAdminPanel from './MarketingAdminPanel'

export const metadata = { title: 'Marketing Admin' }

export default async function AdminMarketingPage({
  searchParams,
}: {
  searchParams: Promise<{
    meta_connected?: string
    meta_error?: string
    google_connected?: string
    google_error?: string
  }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_admin_marketing')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id || (profile.role !== 'admin' && !profile.can_admin_marketing)) {
    redirect('/hub')
  }

  const admin = createAdminClient()
  const { data: accounts } = await admin
    .from('social_accounts')
    .select('id, platform, account_name, external_id, ig_user_id, active, token_expires_at, created_at')
    .eq('company_id', profile.company_id)
    .order('created_at')

  const { meta_connected, meta_error, google_connected, google_error } = await searchParams
  const metaConfigured = !!(process.env.META_APP_ID && process.env.META_APP_SECRET)
  const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

  return (
    <MarketingAdminPanel
      initialAccounts={accounts ?? []}
      metaConfigured={metaConfigured}
      metaConnectedCount={meta_connected ? parseInt(meta_connected) : null}
      metaError={meta_error ?? null}
      googleConfigured={googleConfigured}
      googleConnected={google_connected === '1'}
      googleError={google_error ?? null}
    />
  )
}
