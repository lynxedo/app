import { Suspense } from 'react'
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { selectInChunks } from '@/lib/supabase/chunked-in'
import RoomView from '@/components/hub/RoomView'
import RoomNotifBell from '@/components/hub/RoomNotifBell'
import RoomMembersButton from '@/components/hub/RoomMembersButton'
import PopoutButton from '@/components/hub/popout/PopoutButton'
import { LockIcon } from '@/components/hub/railCatalog'

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>
}) {
  const { roomId } = await params

  // roomId is a UUID column; a non-UUID segment means a stale/typo'd link (or a
  // tool slug that slipped past static routing) — 404 instead of throwing a
  // "invalid input syntax for type uuid" on the rooms query below. (#11)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(roomId)) notFound()

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [roomResult, hubUserResult, profileResult, messagesResult, hubUsersResult, allRoomsResult] = await Promise.all([
    supabase.from('rooms').select('id, name, description, is_private').eq('id', roomId).single(),
    supabase.from('hub_users').select('id, display_name, avatar_url').eq('id', user.id).single(),
    supabase.from('user_profiles').select('role').eq('id', user.id).single(),
    supabase.from('messages')
      .select(`id, content, created_at, edited_at, parent_id, room_id, conversation_id, forwarded_from,
        sender:hub_users!sender_id (id, display_name, avatar_url, is_bot),
        reactions (message_id, user_id, emoji),
        files (id, filename, mime_type, size_bytes, storage_path, width_px, height_px)`)
      .eq('room_id', roomId)
      .is('parent_id', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('hub_users').select('id, display_name, avatar_url, is_bot').order('display_name'),
    supabase.from('rooms').select('id, name').is('archived_at', null).order('name'),
  ])

  if (!roomResult.data) notFound()
  const room = roomResult.data

  const rawMessages = ((messagesResult.data ?? []) as unknown[]).reverse()

  // Reply counts
  const parentIds = rawMessages.map((m) => (m as { id: string }).id)
  const replyRows = await selectInChunks<{ parent_id: string }>(parentIds, (batch) =>
    supabase.from('messages').select('parent_id').in('parent_id', batch).is('deleted_at', null)
  )
  const replyCounts: Record<string, number> = {}
  for (const r of replyRows) {
    replyCounts[r.parent_id] = (replyCounts[r.parent_id] ?? 0) + 1
  }

  // Enrich forwarded messages
  const forwardedIds = rawMessages
    .map((m) => (m as { forwarded_from: string | null }).forwarded_from)
    .filter(Boolean) as string[]
  const forwardedMap: Record<string, object> = {}
  if (forwardedIds.length > 0) {
    const { data: originals } = await supabase
      .from('messages')
      .select('id, content, room_id, conversation_id, sender:hub_users!sender_id (display_name)')
      .in('id', forwardedIds)
    for (const o of originals ?? []) {
      const orig = o as { id: string; sender: { display_name: string } | { display_name: string }[] | null; [key: string]: unknown }
      const sender = Array.isArray(orig.sender) ? orig.sender[0] : orig.sender
      forwardedMap[orig.id as string] = { ...orig, sender }
    }
  }

  const initialMessages = rawMessages.map((m) => {
    const msg = m as { id: string; forwarded_from: string | null; [key: string]: unknown }
    return {
      ...msg,
      reply_count: replyCounts[msg.id] ?? 0,
      forwarded_original: msg.forwarded_from ? forwardedMap[msg.forwarded_from] ?? null : null,
    }
  })

  const displayName = hubUserResult.data?.display_name ?? user.email?.split('@')[0] ?? 'You'

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header data-hide-on-keyboard className="flex-none border-b border-gray-800 px-5 py-3 flex items-center gap-3">
        <span className="text-gray-400 text-lg flex items-center">{room.is_private ? <LockIcon className="w-5 h-5" /> : '#'}</span>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-white leading-tight">{room.name}</h1>
        </div>
        {room.is_private && (
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">Private</span>
        )}
        <RoomMembersButton roomId={roomId} />
        <RoomNotifBell roomId={roomId} />
        <PopoutButton target={{ kind: 'dm', roomId, title: `#${room.name}`, currentUserId: user.id }} />
      </header>

      <Suspense fallback={null}>
        <RoomView
          roomId={roomId}
          initialMessages={initialMessages as never}
          currentUserId={user.id}
          hubUsers={(hubUsersResult.data ?? []) as never}
          isAdmin={profileResult.data?.role === 'admin'}
          senderDisplayName={room.name}
          composerPlaceholder={`Message #${room.name}`}
          rooms={(allRoomsResult.data ?? []) as { id: string; name: string }[]}
        />
      </Suspense>
    </div>
  )
}
