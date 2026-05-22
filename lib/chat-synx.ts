import { createAdminClient } from '@/lib/supabase/admin'

const BOT_TOKEN = process.env.CHAT_SYNX_BOT_TOKEN ?? ''

type PostArgs = {
  channel: string
  text: string
  username: string
  iconUrl?: string | null
  threadTs?: string | null
}

type PostResult = { ok: true; ts: string } | { ok: false; error: string }

async function postMessage({ channel, text, username, iconUrl, threadTs }: PostArgs): Promise<PostResult> {
  if (!BOT_TOKEN) {
    console.warn('[chat-synx] CHAT_SYNX_BOT_TOKEN not set, skipping post')
    return { ok: false, error: 'no_token' }
  }
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel,
        text,
        username,
        icon_url: iconUrl ?? undefined,
        thread_ts: threadTs ?? undefined,
      }),
      signal: AbortSignal.timeout(8000),
    })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; ts?: string; error?: string } | null
    if (!data?.ok) {
      const err = data?.error ?? 'unknown'
      console.warn(`[chat-synx] chat.postMessage failed channel=${channel} error=${err}`)
      return { ok: false, error: err }
    }
    console.log(`[chat-synx] posted ok channel=${channel} ts=${data.ts}`)
    return { ok: true, ts: data.ts ?? '' }
  } catch (e) {
    console.warn(`[chat-synx] chat.postMessage threw: ${(e as Error).message}`)
    return { ok: false, error: 'exception' }
  }
}

// Look up a Slack user's display name + avatar via users.info. Used by the
// admin route when creating a person link to cache identity for outbound posts.
export async function fetchSlackUserProfile(slackUserId: string): Promise<{
  displayName: string | null
  avatarUrl: string | null
} | null> {
  if (!BOT_TOKEN) return null
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`, {
      headers: { Authorization: `Bearer ${BOT_TOKEN}` },
      signal: AbortSignal.timeout(8000),
    })
    const data = (await res.json()) as {
      ok?: boolean
      user?: {
        profile?: { real_name?: string; display_name?: string; image_512?: string; image_192?: string; image_72?: string }
      }
    }
    if (!data?.ok) return null
    const p = data.user?.profile ?? {}
    return {
      displayName: p.display_name?.trim() || p.real_name?.trim() || null,
      avatarUrl: p.image_512 || p.image_192 || p.image_72 || null,
    }
  } catch {
    return null
  }
}

export async function bridgeHubMessageToChatSynx({
  messageId,
  roomId,
  parentId,
  senderId,
  senderName,
  senderAvatarUrl,
  content,
}: {
  messageId: string
  roomId: string | null
  parentId: string | null
  senderId: string
  senderName: string
  senderAvatarUrl: string | null
  content: string
}): Promise<void> {
  if (!BOT_TOKEN || !content.trim() || !roomId) return

  const admin = createAdminClient()

  const { data: bridge } = await admin
    .from('chat_synx_bridges')
    .select('slack_channel_id')
    .eq('hub_room_id', roomId)
    .eq('active', true)
    .maybeSingle()
  if (!bridge?.slack_channel_id) {
    console.log(`[chat-synx] no active bridge for room_id=${roomId}, skipping`)
    return
  }

  // Resolve sender's Slack identity (cached on the link row) if mapped.
  // Falls back to the Hub display name + avatar so unmapped users still post.
  const { data: link } = await admin
    .from('chat_synx_user_links')
    .select('display_name, avatar_url')
    .eq('hub_user_id', senderId)
    .maybeSingle()
  const username = (link?.display_name?.trim() || senderName).slice(0, 80)
  const iconUrl = link?.avatar_url || senderAvatarUrl || null

  // Thread mapping: if this is a reply, find the parent message's slack_ts
  let threadTs: string | null = null
  if (parentId) {
    const { data: parent } = await admin
      .from('messages')
      .select('slack_ts')
      .eq('id', parentId)
      .maybeSingle()
    threadTs = parent?.slack_ts ?? null
  }

  const result = await postMessage({
    channel: bridge.slack_channel_id,
    text: content.trim(),
    username,
    iconUrl,
    threadTs,
  })

  if (result.ok && result.ts) {
    await admin
      .from('messages')
      .update({ slack_ts: result.ts })
      .eq('id', messageId)
    console.log(`[chat-synx] saved slack_ts=${result.ts} on message=${messageId}`)
  }
}
