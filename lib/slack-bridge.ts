import { createAdminClient } from '@/lib/supabase/admin'

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? ''

type SlackPostArgs = {
  channel: string
  text: string
  username: string
}

async function postToSlack({ channel, text, username }: SlackPostArgs): Promise<void> {
  if (!SLACK_BOT_TOKEN) {
    console.warn('[slack-bridge] SLACK_BOT_TOKEN not set, skipping post')
    return
  }
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({ channel, text, username }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json().catch(() => null)
    if (!data?.ok) {
      console.warn(`[slack-bridge] chat.postMessage failed channel=${channel} error=${data?.error ?? 'unknown'}`)
    } else {
      console.log(`[slack-bridge] posted to channel=${channel}`)
    }
  } catch (e) {
    console.warn(`[slack-bridge] chat.postMessage threw: ${(e as Error).message}`)
  }
}

async function openDmChannel(slackUserId: string): Promise<string | null> {
  if (!SLACK_BOT_TOKEN) return null
  try {
    const res = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({ users: slackUserId }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json()
    if (!data?.ok) {
      console.warn(`[slack-bridge] conversations.open failed user=${slackUserId} error=${data?.error ?? 'unknown'}`)
      return null
    }
    return data?.channel?.id ?? null
  } catch (e) {
    console.warn(`[slack-bridge] conversations.open threw: ${(e as Error).message}`)
    return null
  }
}

export async function bridgeHubMessageToSlack({
  roomId,
  conversationId,
  senderId,
  senderName,
  content,
}: {
  roomId: string | null
  conversationId: string | null
  senderId: string
  senderName: string
  content: string
}): Promise<void> {
  if (!SLACK_BOT_TOKEN || !content.trim()) return

  const admin = createAdminClient()

  if (roomId) {
    // Room bridge: look up by hub_room_id
    const { data: bridge } = await admin
      .from('slack_bridges')
      .select('slack_channel_id')
      .eq('bridge_type', 'room')
      .eq('hub_room_id', roomId)
      .eq('active', true)
      .maybeSingle()
    if (!bridge?.slack_channel_id) {
      console.log(`[slack-bridge] no active room bridge for room_id=${roomId}, skipping`)
      return
    }
    console.log(`[slack-bridge] room ${roomId} → slack channel ${bridge.slack_channel_id}`)
    await postToSlack({
      channel: bridge.slack_channel_id,
      text: content,
      username: `${senderName} via Hub`,
    })
    return
  }

  if (conversationId) {
    // DM bridge: find the other participant who has a slack_user_id mapping.
    // For self-DMs (only the sender is in the conversation), route to the sender's own bridge.
    const { data: members } = await admin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId)
    const allMemberIds = (members ?? []).map((m: { user_id: string }) => m.user_id)
    const otherIds = allMemberIds.filter((id) => id !== senderId)
    const isSelfDm = allMemberIds.length === 1 && allMemberIds[0] === senderId
    const lookupIds = isSelfDm ? [senderId] : otherIds

    if (lookupIds.length === 0) {
      console.log(`[slack-bridge] no recipients for conversation_id=${conversationId}, skipping`)
      return
    }

    const { data: bridge } = await admin
      .from('slack_bridges')
      .select('slack_user_id')
      .eq('bridge_type', 'dm')
      .in('hub_user_id', lookupIds)
      .eq('active', true)
      .limit(1)
      .maybeSingle()
    if (!bridge?.slack_user_id) {
      console.log(`[slack-bridge] no active DM bridge for hub_user_id IN (${lookupIds.join(',')}), skipping`)
      return
    }

    const channelId = await openDmChannel(bridge.slack_user_id)
    if (!channelId) return
    console.log(`[slack-bridge] DM ${conversationId} → slack user ${bridge.slack_user_id} (channel ${channelId})${isSelfDm ? ' [self-DM]' : ''}`)
    await postToSlack({
      channel: channelId,
      text: content,
      username: `${senderName} via Hub`,
    })
  }
}
