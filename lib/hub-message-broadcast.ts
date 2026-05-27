import { createAdminClient } from '@/lib/supabase/admin'

// Fires the realtime broadcasts MessageFeed + ThreadPanel + HubSidebar
// listen on, so a server-side admin-client insert reaches open browsers
// even when Supabase postgres_changes silently drops the WAL event (iOS
// webview websocket suspension + general flakiness). The user-message POST
// has fired these since 300608c; this helper extracts the pattern so every
// other admin-client insert site (Guardian / Claude bot, scheduled
// delivery, Chat Synx, etc.) can fire them too without duplicating the
// subscribe/send/remove boilerplate. Threaded messages (parent_id set) also
// broadcast on `thread:<parentId>` so an OPEN thread updates live.
//
// Fire-and-forget: callers should `void broadcastMessageInserted(...)`
// so a slow broadcast can't delay the API response.

// Subscribe to a topic, WAIT until the channel has actually joined, then
// send. The previous code did `await channel.subscribe()` immediately
// followed by `.send()` — but `.subscribe()` resolves before the socket
// has joined the topic, so the send routinely raced ahead of the join and
// was dropped server-side. That race is why Guardian/admin-client realtime
// updates only landed "sometimes." Waiting for the SUBSCRIBED status fixes
// it. Each send is wrapped by the caller in try/catch + fire-and-forget,
// so the 5s safety timeout just logs and moves on if realtime is unhealthy.
async function broadcastOnce(
  client: ReturnType<typeof createAdminClient>,
  topic: string,
  payload: Record<string, unknown>,
) {
  const channel = client.channel(topic)
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('subscribe timeout')), 5000)
      channel.subscribe((status, err) => {
        const s = String(status)
        if (s === 'SUBSCRIBED') {
          clearTimeout(timeout)
          resolve()
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
          clearTimeout(timeout)
          reject(err ?? new Error(s))
        }
      })
    })
    await channel.send({ type: 'broadcast', event: 'message-inserted', payload })
  } finally {
    await client.removeChannel(channel)
  }
}

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

  // Main feed (MessageFeed) — bumps the parent's reply count for threaded
  // messages, appends top-level messages.
  if (feedKey) {
    try {
      await broadcastOnce(broadcastAdmin, `feed:${feedKey}`, {
        id: messageId, parent_id: parentId, sender_id: senderId,
      })
    } catch (err) {
      console.warn('[messages] feed broadcast failed:', (err as Error).message)
    }
  }

  // Open ThreadPanel — postgres_changes drops admin-client inserts (Guardian
  // replies especially), so an open thread needs this fallback to show the
  // reply (and bump the count) without a manual refresh.
  if (parentId) {
    try {
      await broadcastOnce(broadcastAdmin, `thread:${parentId}`, {
        id: messageId, parent_id: parentId, sender_id: senderId,
      })
    } catch (err) {
      console.warn('[messages] thread broadcast failed:', (err as Error).message)
    }
  }

  // Sidebar — unread badges.
  try {
    await broadcastOnce(broadcastAdmin, 'hub-sidebar-messages', {
      id: messageId,
      room_id: roomId,
      conversation_id: conversationId,
      parent_id: parentId,
      sender_id: senderId,
    })
  } catch (err) {
    console.warn('[messages] sidebar broadcast failed:', (err as Error).message)
  }
}
