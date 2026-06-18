import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchLeadsWithNotes } from '@/lib/tracker/leads'
import TrackerPage from '../TrackerPage'

export default async function HubLeadTrackerRoute() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileRes, settingsRes, stagesRes, columnsRes] = await Promise.all([
    supabase.from('user_profiles').select('role, tracker_column_layout').eq('id', user.id).single(),
    supabase.from('tracker_settings').select('*').single(),
    supabase.from('tracker_stages').select('*').order('sort_order', { ascending: true }),
    supabase.from('tracker_column_definitions').select('*').order('sort_order', { ascending: true }),
  ])

  let initialLeads: Awaited<ReturnType<typeof fetchLeadsWithNotes>> | null = null
  try {
    initialLeads = await fetchLeadsWithNotes(supabase)
  } catch {
    initialLeads = null
  }

  const currentUser = {
    email: user.email ?? '',
    name: user.email?.split('@')[0] ?? 'Unknown',
    isAdmin: profileRes.data?.role === 'admin',
  }

  const initialColumnLayout = Array.isArray(profileRes.data?.tracker_column_layout)
    ? profileRes.data.tracker_column_layout as { id: string; width: number; hidden?: boolean }[]
    : null

  return (
    <TrackerPage
      settings={settingsRes.data}
      currentUser={currentUser}
      initialColumnLayout={initialColumnLayout}
      initialLeads={initialLeads}
      stages={stagesRes.data ?? []}
      customColumnDefs={columnsRes.data ?? []}
    />
  )
}
