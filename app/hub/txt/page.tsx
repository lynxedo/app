import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TxtLandingPanel from '@/components/hub/txt/TxtLandingPanel'

export default async function TxtIndexPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_txt, can_assign_txt_threads, can_access_txt, can_access_unified_inbox')
    .eq('id', user.id)
    .single()

  // Txt2 (new Twilio texting) is gated per-user. Non-enabled users land on the
  // old Captivated inbox they still have.
  if (!profile?.can_access_txt) redirect('/hub/clients')

  const isAdmin = profile?.role === 'admin' || profile?.can_admin_txt === true
  const canAccessUnifiedInbox =
    profile?.role === 'admin' || profile?.can_access_unified_inbox === true

  return <TxtLandingPanel isAdmin={!!isAdmin} canAccessUnifiedInbox={canAccessUnifiedInbox} />
}
