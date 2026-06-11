import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import HubAdminPanel from '../hub/HubAdminPanel'

export const metadata = { title: 'Announcements Admin' }

// Announcements share the Hub admin permission. This renders the Announcements
// section of HubAdminPanel as its own top-level admin page (no Hub tab bar).
export default async function AdminAnnouncementsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_admin_announcements')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_announcements) redirect('/hub/home')

  const { data: activeAnnouncementsRaw } = await supabase
    .from('hub_announcements')
    .select('id, content, created_at, expires_at, type, archived_at, edited_at, created_by')
    .is('archived_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  // Newest non-expired, non-archived per type.
  type Row = { id: string; content: string; created_at: string; expires_at: string; type: 'announcement' | 'shout_out'; archived_at: string | null; edited_at: string | null; created_by: string }
  const seen = new Set<string>()
  const activeAnnouncements = ((activeAnnouncementsRaw ?? []) as Row[]).filter(r => {
    if (seen.has(r.type)) return false
    seen.add(r.type)
    return true
  })

  return (
    <HubAdminPanel
      initialRooms={[]}
      hubUsers={[]}
      allowMemberRoomCreation={false}
      activeAnnouncements={activeAnnouncements}
      only="announcements"
    />
  )
}
