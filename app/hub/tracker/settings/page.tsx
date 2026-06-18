import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SettingsPage from './SettingsPage'

export default async function HubTrackerSettingsRoute() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileRes, settingsRes, stagesRes, columnsRes] = await Promise.all([
    supabase.from('user_profiles').select('role').eq('id', user.id).single(),
    supabase.from('tracker_settings').select('*').single(),
    supabase.from('tracker_stages').select('*').order('sort_order', { ascending: true }),
    supabase.from('tracker_column_definitions').select('*').order('sort_order', { ascending: true }),
  ])

  if (profileRes.data?.role !== 'admin') redirect('/hub/tracker')

  return (
    <SettingsPage
      initialSettings={settingsRes.data}
      initialStages={stagesRes.data ?? []}
      initialColumnDefs={columnsRes.data ?? []}
    />
  )
}
