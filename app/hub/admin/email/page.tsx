import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import EmailAdminPanel from './EmailAdminPanel'

export const metadata = { title: 'Email Marketing Admin' }

export default async function AdminEmailPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_admin_email')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id || (profile.role !== 'admin' && !profile.can_admin_email)) {
    redirect('/hub')
  }

  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('email_settings')
    .select('physical_address')
    .eq('company_id', profile.company_id)
    .maybeSingle()

  return <EmailAdminPanel initialSettings={settings ?? null} />
}
