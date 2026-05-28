import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import SocialView from '@/components/hub/marketing/SocialView'

export const metadata = { title: 'Social | Marketing' }

export default async function MarketingSocialPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_marketing, can_admin_marketing, role, company_id')
    .eq('id', user.id)
    .single()

  if (!profile?.can_access_marketing) redirect('/hub')

  const admin = createAdminClient()
  const { data: accounts } = await admin
    .from('social_accounts')
    .select('id, platform, account_name, external_id, ig_user_id, active')
    .eq('company_id', profile.company_id!)
    .eq('active', true)
    .order('created_at')

  const isAdmin = profile.role === 'admin' || !!profile.can_admin_marketing

  return (
    <SocialView
      initialAccounts={accounts ?? []}
      canAdmin={isAdmin}
    />
  )
}
