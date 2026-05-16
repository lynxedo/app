import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import HubSidebar from '@/components/hub/HubSidebar'
import PushInit from '@/components/hub/PushInit'

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [roomsResult, hubUsersResult, meResult] = await Promise.all([
    supabase.from('rooms').select('id, name, is_private').is('archived_at', null).order('name'),
    supabase.from('hub_users').select('id, display_name, avatar_url, is_bot, status').order('display_name'),
    supabase.from('hub_users').select('display_name, status').eq('id', user.id).single(),
  ])

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <HubSidebar
        rooms={roomsResult.data ?? []}
        userEmail={user.email ?? ''}
        currentUserId={user.id}
        hubUsers={(hubUsersResult.data ?? []) as never}
        currentUserStatus={meResult.data?.status ?? null}
        currentUserDisplayName={meResult.data?.display_name ?? undefined}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {children}
      </div>
      <PushInit />
    </div>
  )
}
