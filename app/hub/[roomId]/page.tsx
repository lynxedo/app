import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import MessageFeed from '@/components/hub/MessageFeed'
import MessageComposer from '@/components/hub/MessageComposer'

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>
}) {
  const { roomId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Load the room
  const { data: room } = await supabase
    .from('rooms')
    .select('id, name, description, is_private')
    .eq('id', roomId)
    .single()

  if (!room) notFound()

  // Load the current user's hub profile
  const { data: hubUser } = await supabase
    .from('hub_users')
    .select('id, display_name, avatar_url')
    .eq('id', user.id)
    .single()

  // Load initial messages (most recent 50, oldest first for display)
  const { data: messages } = await supabase
    .from('messages')
    .select(`
      id, content, created_at, edited_at,
      sender:hub_users!sender_id (id, display_name, avatar_url, is_bot)
    `)
    .eq('room_id', roomId)
    .is('parent_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50)

  const initialMessages = (messages ?? []).reverse()

  return (
    <div className="flex flex-col h-full">
      {/* Room header */}
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

      {/* Message feed — grows to fill remaining space */}
      <MessageFeed
        roomId={roomId}
        initialMessages={initialMessages}
        currentUserId={user.id}
      />

      {/* Composer pinned to bottom */}
      <MessageComposer
        roomId={roomId}
        senderDisplayName={hubUser?.display_name ?? user.email?.split('@')[0] ?? 'You'}
      />
    </div>
  )
}
