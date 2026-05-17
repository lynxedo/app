import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import HubShell from '@/components/hub/HubShell'
import PushInit from '@/components/hub/PushInit'

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const now = new Date().toISOString()
  const [roomsResult, hubUsersResult, meResult, profileResult, announcementResult] = await Promise.all([
    supabase.from('rooms').select('id, name, is_private').is('archived_at', null).order('name'),
    supabase.from('hub_users').select('id, display_name, avatar_url, is_bot, status').order('display_name'),
    supabase.from('hub_users').select('display_name, status').eq('id', user.id).single(),
    supabase.from('user_profiles').select('role').eq('id', user.id).single(),
    supabase
      .from('hub_announcements')
      .select('id, content, expires_at, reactions:announcement_reactions(announcement_id, user_id, emoji)')
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const isAdmin = profileResult.data?.role === 'admin'

  const ann = announcementResult.data
  const initialAnnouncement = ann
    ? {
        id: ann.id as string,
        content: ann.content as string,
        expires_at: ann.expires_at as string,
        reactions: (Array.isArray(ann.reactions) ? ann.reactions : []) as Array<{ announcement_id: string; user_id: string; emoji: string }>,
      }
    : null

  return (
    <>
      <HubShell
        rooms={roomsResult.data ?? []}
        userEmail={user.email ?? ''}
        currentUserId={user.id}
        hubUsers={(hubUsersResult.data ?? []) as never}
        currentUserStatus={meResult.data?.status ?? null}
        currentUserDisplayName={meResult.data?.display_name ?? undefined}
        isAdmin={isAdmin}
        initialAnnouncement={initialAnnouncement}
      >
        {children}
      </HubShell>
      <PushInit />
    </>
  )
}
