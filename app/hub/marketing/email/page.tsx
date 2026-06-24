import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import EmailView from '@/components/hub/marketing/EmailView'

export const metadata = { title: 'Email | Marketing' }

export default async function MarketingEmailPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_email, can_admin_email, role, company_id')
    .eq('id', user.id)
    .single()

  const canAccess = profile?.role === 'admin' || !!profile?.can_access_email
  if (!canAccess) redirect('/hub')

  const isAdmin = profile?.role === 'admin' || !!profile?.can_admin_email

  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('email_settings')
    .select('from_name, from_email, reply_to, sending_domain, domain_verified')
    .eq('company_id', profile!.company_id!)
    .maybeSingle()

  return <EmailView settings={settings ?? null} canAdmin={isAdmin} />
}
