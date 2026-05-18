import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import HubAdminPanel from './HubAdminPanel'

export const metadata = { title: 'Hub Admin' }

export default async function AdminHubPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const admin = createAdminClient()

  const [roomsResult, hubUsersResult, settingsResult, announcementResult] = await Promise.all([
    admin.from('rooms').select('id, name, description, is_private, archived_at, claude_enabled').order('name'),
    supabase.from('hub_users').select('id, display_name, claude_allowed').eq('is_bot', false).order('display_name'),
    supabase.from('hub_settings').select('allow_member_room_creation').eq('company_id', profile.company_id!).maybeSingle(),
    supabase
      .from('hub_announcements')
      .select('id, content, created_at, expires_at')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return (
    <HubAdminPanel
      initialRooms={roomsResult.data ?? []}
      hubUsers={hubUsersResult.data ?? []}
      allowMemberRoomCreation={settingsResult.data?.allow_member_room_creation ?? true}
      activeAnnouncement={announcementResult.data ?? null}
    />
  )
}
