import { redirect } from 'next/navigation'
import Link from 'next/link'
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
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/hub" className="text-gray-400 hover:text-white text-sm transition-colors">
            ← Hub
          </Link>
          <span className="text-gray-600">·</span>
          <Link href="/admin" className="text-gray-400 hover:text-white text-sm transition-colors">
            Admin
          </Link>
          <span className="text-gray-600">·</span>
          <span className="text-xl font-bold tracking-tight">Hub Admin</span>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-10">
        <HubAdminPanel
          initialRooms={roomsResult.data ?? []}
          hubUsers={hubUsersResult.data ?? []}
          allowMemberRoomCreation={settingsResult.data?.allow_member_room_creation ?? true}
          activeAnnouncement={announcementResult.data ?? null}
        />
      </main>
    </div>
  )
}
