import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchLeadsWithNotes } from '@/lib/tracker/leads'
import TrackerPage from '../TrackerPage'

export default async function HubLeadTrackerRoute() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, tracker_column_layout')
    .eq('id', user.id)
    .single()

  const { data: settings } = await supabase
    .from('tracker_settings')
    .select('*')
    .single()

  // Prefetch the full (unfiltered) lead list on the server so the table paints
  // with data on first load — no client round-trip, no "Loading leads…" gap.
  // A failed prefetch just falls back to the client fetch (empty initial list).
  let initialLeads: Awaited<ReturnType<typeof fetchLeadsWithNotes>> | null = null
  try {
    initialLeads = await fetchLeadsWithNotes(supabase)
  } catch {
    initialLeads = null
  }

  const currentUser = {
    email: user.email ?? '',
    name: user.email?.split('@')[0] ?? 'Unknown',
    isAdmin: profile?.role === 'admin',
  }

  const initialColumnLayout = Array.isArray(profile?.tracker_column_layout)
    ? profile.tracker_column_layout as { id: string; width: number; hidden?: boolean }[]
    : null

  return (
    <TrackerPage
      settings={settings}
      currentUser={currentUser}
      initialColumnLayout={initialColumnLayout}
      initialLeads={initialLeads}
    />
  )
}
