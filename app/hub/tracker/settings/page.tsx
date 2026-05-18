import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SettingsPage from './SettingsPage'

export default async function HubTrackerSettingsRoute() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/hub/tracker')

  const { data: settings } = await supabase
    .from('tracker_settings')
    .select('*')
    .single()

  return <SettingsPage initialSettings={settings} />
}
