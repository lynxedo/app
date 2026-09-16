// Server → phones, the fast path. The DB rows are the truth; a phone that misses a
// broadcast recovers on its next GET /api/hub/radio/session/[id]. Same one-shot
// admin-channel pattern as lib/hub-presence-broadcast.ts.
//
// ⚠ Payloads never carry audio URLs. Broadcast topics are not row-secured, so a
// signed URL in a payload would be a recording handed to anyone holding the topic
// name. Payloads carry ids; the client fetches audio through the participant-gated
// GET /api/hub/radio/piece/[id].
import { createAdminClient } from '@/lib/supabase/admin'

export type RadioEvent =
  | 'invite'            // radio-user:{recipient}   { sessionId, conversationId, fromId, fromName }
  | 'accepted'          // radio:{id} + radio-user:{initiator}
  | 'declined'          // radio:{id} + radio-user:{initiator}
  | 'closed'            // radio:{id} + both user topics
  | 'talking-start'     // radio:{id}  { transmissionId, senderId, startedAt }  ← locks the other button
  | 'piece-ready'       // radio:{id}  { transmissionId, seq, pieceId }
  | 'transmission-end'  // radio:{id}  { transmissionId, senderId, pieceCount }

export async function radioBroadcast(topic: string, event: RadioEvent, payload: Record<string, unknown>): Promise<void> {
  try {
    const admin = createAdminClient()
    const channel = admin.channel(topic)
    await channel.subscribe()
    await channel.send({ type: 'broadcast', event, payload })
    await admin.removeChannel(channel)
  } catch {
    // Best-effort by design — the row is already written; the next GET reconciles.
  }
}

/** Fan one event out to several topics (a session topic plus the people's own). */
export async function radioBroadcastAll(topics: string[], event: RadioEvent, payload: Record<string, unknown>): Promise<void> {
  await Promise.all(topics.map(t => radioBroadcast(t, event, payload)))
}
