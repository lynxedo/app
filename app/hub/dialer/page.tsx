import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DialerPanel from './DialerPanel'

export default async function DialerIndexPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_access_dialer, can_admin_dialer, can_admin_hub')
    .eq('id', user.id)
    .single()

  if (!profile?.can_access_dialer) redirect('/hub')

  const isAdmin =
    profile.role === 'admin' ||
    !!profile.can_admin_dialer ||
    !!profile.can_admin_hub

  return <DialerPanel isAdmin={isAdmin} />
}
