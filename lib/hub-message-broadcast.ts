import { createAdminClient } from '@/lib/supabase/admin'

// Fires the two realtime broadcasts MessageFeed + HubSidebar listen on,
// so a server-side admin-client insert reaches open browsers even when
// Supabase postgres_changes silently drops the WAL event (iOS webview
// websocket suspension + general flakiness). The user-message POST has
// fired these since 300608c; this helper extracts the pattern so every
// other admin-client insert site (Guardian / Claude bot, scheduled
// delivery, Chat Synx, etc.) can fire them too without duplicating ~30
// lines of subscribe/send/remove boilerplate.
//
// Fire-and-forget: callers should `void broadcastMessageInserted(...)`
// so a slow broadcast can't delay the API response.
export async function broadcastMessageInserted({
  messageId,
  roomId,
  conversationId,
  parentId,
  senderId,
}: {
  messageId: string
  roomId: string | null
  conversationId: string | null
  parentId: string | null
  senderId: string
}) {
  const broadcastAdmin = createAdminClient()
  const feedKey = roomId ?? conversationId
  if (feedKey) {
    try {
      const feedChannel = broadcastAdmin.channel(`feed:${feedKey}`)
      await feedChannel.subscribe()
      await feedChannel.send({
        type: 'broadcast',
        event: 'message-inserted',
        payload: { id: messageId, parent_id: parentId, sender_id: senderId },
      })
      await broadcastAdmin.removeChannel(feedChannel)
    } catch (err) {
      console.warn('[messages] feed broadcast failed:', (err as Error).message)
    }
  }
  try {
    const sidebarChannel = broadcastAdmin.channel('hub-sidebar-messages')
    await sidebarChannel.subscribe()
    await sidebarChannel.send({
      type: 'broadcast',
      event: 'message-inserted',
      payload: {
        id: messageId,
        room_id: roomId,
        conversation_id: conversationId,
        parent_id: parentId,
        sender_id: senderId,
      },
    })
    await broadcastAdmin.removeChannel(sidebarChannel)
  } catch (err) {
    console.warn('[messages] sidebar broadcast failed:', (err as Error).message)
  }
}
