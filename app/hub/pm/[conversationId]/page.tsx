import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import RoomView from '@/components/hub/RoomView'
import type { HubUser } from '@/components/hub/MessageFeed'

export default async function PMPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}) {
  const { conversationId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Verify user is a member
  const { data: membership } = await supabase
    .from('conversation_members')
    .select('conversation_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id)
    .single()

  if (!membership) notFound()

  // Get all participants using admin client
  const admin = createAdminClient()
  const { data: members } = await admin
    .from('conversation_members')
    .select('user_id, hub_users!user_id(id, display_name, avatar_url, is_bot)')
    .eq('conversation_id', conversationId)

  type MemberRow = { user_id: string; hub_users: HubUser | HubUser[] }
  const participants: HubUser[] = (members ?? []).map((m: unknown) => {
    const row = m as MemberRow
    return Array.isArray(row.hub_users) ? row.hub_users[0] : row.hub_users
  }).filter(Boolean) as HubUser[]

  const others = participants.filter(p => p.id !== user.id)
  const convTitle = others.length === 0
    ? 'Just you'
    : others.map(p => p.display_name).join(', ')

  // Load initial messages
  const { data: messages } = await supabase
    .from('messages')
    .select(`
      id, content, created_at, edited_at, parent_id, room_id, conversation_id,
      sender:hub_users!sender_id (id, display_name, avatar_url, is_bot),
      reactions (message_id, user_id, emoji),
      files (id, filename, mime_type, size_bytes, storage_path)
    `)
    .eq('conversation_id', conversationId)
    .is('parent_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50)

  const { data: hubUsers } = await supabase
    .from('hub_users')
    .select('id, display_name, avatar_url, is_bot')
    .order('display_name')

  const rawMessages = ((messages ?? []) as unknown[]).reverse()

  const parentIds = rawMessages.map((m) => (m as { id: string }).id)
  const { data: replyRows } = parentIds.length
    ? await supabase.from('messages').select('parent_id').in('parent_id', parentIds).is('deleted_at', null)
    : { data: [] }
  const replyCounts: Record<string, number> = {}
  for (const r of (replyRows ?? []) as { parent_id: string }[]) {
    replyCounts[r.parent_id] = (replyCounts[r.parent_id] ?? 0) + 1
  }
  const initialMessages = rawMessages.map((m) => ({
    ...(m as object),
    reply_count: replyCounts[(m as { id: string }).id] ?? 0,
  }))

  return (
    <div className="flex flex-col h-full">
      <header className="flex-none border-b border-gray-800 px-5 py-3 flex items-center gap-3">
        <span className="text-gray-400">💬</span>
        <h1 className="font-semibold text-white">{convTitle}</h1>
        {others.length > 1 && (
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{others.length + 1} people</span>
        )}
      </header>

      <RoomView
        conversationId={conversationId}
        initialMessages={initialMessages as never}
        currentUserId={user.id}
        hubUsers={(hubUsers ?? []) as never}
        senderDisplayName={convTitle}
        composerPlaceholder={`Message ${convTitle}`}
      />
    </div>
  )
}
