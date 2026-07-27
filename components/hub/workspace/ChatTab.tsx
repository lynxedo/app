'use client'

/**
 * Workspace-tab twin for a Hub conversation — a room (`roomId`) or a DM
 * (`conversationId`). Renders the REAL `RoomView` (full feed + composer +
 * threads + reactions + files + read receipts), NOT the stripped pop-out.
 * RoomView/MessageFeed self-fetch older pages and open their own realtime
 * channels, so a backgrounded conversation tab stays LIVE.
 *
 * We seed the most-recent window here because MessageFeed with
 * initialMessages=[] shows empty on a cold IndexedDB cache AND can't paginate
 * (`hasMoreOlder` keys off `initialMessages.length >= page size`). The SELECT
 * mirrors the server room/DM page.
 *
 * ⚠ v1 simplifications (self-correcting, non-blocking): seeded rows carry
 * reply_count 0 + no forwarded-original preview (fix themselves via realtime /
 * opening a thread); the DM "read by" roster isn't seeded (server-admin-only) —
 * the live receipts channel still streams once mounted.
 */

import { useEffect, useState, type ComponentProps } from 'react'
import { createClient } from '@/lib/supabase/client'
import RoomView from '@/components/hub/RoomView'
import type { HubMessage } from '@/components/hub/MessageFeed'

type RoomViewProps = ComponentProps<typeof RoomView>

const MESSAGE_SELECT = `id, content, created_at, edited_at, parent_id, room_id, conversation_id, forwarded_from,
  sender:hub_users!sender_id (id, display_name, avatar_url, is_bot),
  reactions (message_id, user_id, emoji),
  files (id, filename, mime_type, size_bytes, storage_path, width_px, height_px)`

export default function ChatTab({
  roomId,
  conversationId,
  label,
  currentUserId,
  hubUsers,
  isAdmin,
  rooms,
}: {
  roomId?: string
  conversationId?: string
  label: string
  currentUserId: string
  hubUsers: RoomViewProps['hubUsers']
  isAdmin: boolean
  rooms?: RoomViewProps['rooms']
}) {
  const [initial, setInitial] = useState<HubMessage[] | null>(null)

  useEffect(() => {
    const id = roomId ?? conversationId
    if (!id) { setInitial([]); return }
    let alive = true
    const supabase = createClient()
    supabase
      .from('messages')
      .select(MESSAGE_SELECT)
      .eq(roomId ? 'room_id' : 'conversation_id', id)
      .is('parent_id', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!alive) return
        const rows = ((data ?? []) as unknown as HubMessage[]).slice().reverse()
        for (const m of rows) {
          m.reply_count = m.reply_count ?? 0
          m.forwarded_original = m.forwarded_original ?? null
        }
        setInitial(rows)
      })
    return () => { alive = false }
  }, [roomId, conversationId])

  if (initial === null) return <div className="flex-1 min-h-0 p-6 text-sm text-white/50">Loading conversation…</div>

  return (
    <RoomView
      roomId={roomId}
      conversationId={conversationId}
      initialMessages={initial}
      currentUserId={currentUserId}
      hubUsers={hubUsers}
      isAdmin={isAdmin}
      senderDisplayName={label}
      composerPlaceholder={roomId ? `Message #${label}` : `Message ${label}`}
      rooms={rooms}
    />
  )
}
