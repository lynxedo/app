import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardPage from './DashboardPage'

export default async function HubTrackerDashboardRoute() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: settings } = await supabase
    .from('tracker_settings')
    .select('salesperson_options')
    .single()

  return (
    <DashboardPage
      salespersonOptions={settings?.salesperson_options ?? []}
      isAdmin={profile?.role === 'admin'}
    />
  )
}
