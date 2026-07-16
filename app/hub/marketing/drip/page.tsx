import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DripView from '@/components/hub/marketing/DripView'

export const metadata = { title: 'Drip | Marketing' }

export default async function MarketingDripPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_manage_drip, role')
    .eq('id', user.id)
    .single()

  const canAccess = profile?.role === 'admin' || !!profile?.can_manage_drip
  if (!canAccess) redirect('/hub')

  return <DripView />
}
