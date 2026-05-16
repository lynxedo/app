import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import RoomView from '@/components/hub/RoomView'

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>
}) {
  const { roomId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: room } = await supabase
    .from('rooms')
    .select('id, name, description, is_private')
    .eq('id', roomId)
    .single()

  if (!room) notFound()

  const { data: hubUser } = await supabase
    .from('hub_users')
    .select('id, display_name, avatar_url')
    .eq('id', user.id)
    .single()

  const { data: messages } = await supabase
    .from('messages')
    .select(`
      id, content, created_at, edited_at, parent_id, room_id, conversation_id,
      sender:hub_users!sender_id (id, display_name, avatar_url, is_bot),
      reactions (message_id, user_id, emoji),
      files (id, filename, mime_type, size_bytes, storage_path)
    `)
    .eq('room_id', roomId)
    .is('parent_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50)

  const { data: hubUsers } = await supabase
    .from('hub_users')
    .select('id, display_name, avatar_url, is_bot')
    .order('display_name')

  const rawMessages = ((messages ?? []) as unknown[]).reverse()

  // Count thread replies per parent message
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

  const displayName = hubUser?.display_name ?? user.email?.split('@')[0] ?? 'You'

  return (
    <div className="flex flex-col h-full">
      <header className="flex-none border-b border-gray-800 px-5 py-3 flex items-center gap-3">
        <span className="text-gray-400 text-lg">#</span>
        <div>
          <h1 className="font-semibold text-white leading-tight">{room.name}</h1>
          {room.description && (
            <p className="text-gray-500 text-xs mt-0.5">{room.description}</p>
          )}
        </div>
        {room.is_private && (
          <span className="ml-auto text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">Private</span>
        )}
      </header>

      <RoomView
        roomId={roomId}
        initialMessages={initialMessages as never}
        currentUserId={user.id}
        hubUsers={(hubUsers ?? []) as never}
        senderDisplayName={room.name}
        composerPlaceholder={`Message #${room.name}`}
      />
    </div>
  )
}
