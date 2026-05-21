import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FleetPage from './FleetPage'

export const metadata = { title: 'Fleet' }

export default async function HubFleetPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_fleet, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_fleet) redirect('/hub')

  return <FleetPage />
}
