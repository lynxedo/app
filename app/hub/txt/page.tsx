import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TxtLandingPanel from '@/components/hub/txt/TxtLandingPanel'

export default async function TxtIndexPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_hub, can_assign_txt_threads')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin' || profile?.can_admin_hub === true

  return <TxtLandingPanel isAdmin={!!isAdmin} />
}
