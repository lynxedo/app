import { createAdminClient } from '@/lib/supabase/admin'

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? ''

type SlackPostArgs = {
  channel: string
  text: string
  username: string
}

async function postToSlack({ channel, text, username }: SlackPostArgs): Promise<void> {
  if (!SLACK_BOT_TOKEN) return
  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({ channel, text, username }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    // Don't break the Hub message insert if Slack is down
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
    return data?.channel?.id ?? null
  } catch {
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
    if (!bridge?.slack_channel_id) return
    await postToSlack({
      channel: bridge.slack_channel_id,
      text: content,
      username: `${senderName} via Hub`,
    })
    return
  }

  if (conversationId) {
    // DM bridge: find the other participant who has a slack_user_id mapping
    const { data: members } = await admin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .neq('user_id', senderId)
    const otherIds = (members ?? []).map((m: { user_id: string }) => m.user_id)
    if (otherIds.length === 0) return

    const { data: bridge } = await admin
      .from('slack_bridges')
      .select('slack_user_id')
      .eq('bridge_type', 'dm')
      .in('hub_user_id', otherIds)
      .eq('active', true)
      .limit(1)
      .maybeSingle()
    if (!bridge?.slack_user_id) return

    const channelId = await openDmChannel(bridge.slack_user_id)
    if (!channelId) return
    await postToSlack({
      channel: channelId,
      text: content,
      username: `${senderName} via Hub`,
    })
  }
}
