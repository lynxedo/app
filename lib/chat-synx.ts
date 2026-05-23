import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { createAdminClient } from '@/lib/supabase/admin'
import { nativeToSlack } from '@/lib/chat-synx-emoji'
import { translateHubToSlack } from '@/lib/chat-synx-mentions'

const BOT_TOKEN = process.env.CHAT_SYNX_BOT_TOKEN ?? ''

function getR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
    },
  })
}

async function downloadFromR2(storagePath: string): Promise<Buffer | null> {
  try {
    const r2 = getR2Client()
    const res = await r2.send(new GetObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: storagePath,
    }))
    if (!res.Body) return null
    const stream = res.Body as { transformToByteArray: () => Promise<Uint8Array> }
    const bytes = await stream.transformToByteArray()
    return Buffer.from(bytes)
  } catch (err) {
    console.warn(`[chat-synx] R2 download failed key=${storagePath}: ${(err as Error).message}`)
    return null
  }
}

// Upload one file to Slack via the 3-step external-upload flow (the old
// files.upload was deprecated in March 2025). Returns the slack file id on
// success, null on failure. Posts into the given channel optionally as a
// thread reply, with an optional initial_comment (used when there is no
// separate text message — keeps the post readable).
async function uploadFileToSlack({
  channel,
  threadTs,
  filename,
  contentType,
  bytes,
  initialComment,
}: {
  channel: string
  threadTs: string | null
  filename: string
  contentType: string
  bytes: Buffer
  initialComment?: string
}): Promise<string | null> {
  if (!BOT_TOKEN) return null

  try {
    // Step 1: getUploadURLExternal — returns a one-shot upload URL + file id.
    const params = new URLSearchParams({ filename, length: String(bytes.byteLength) })
    const getUrl = await fetch(`https://slack.com/api/files.getUploadURLExternal?${params.toString()}`, {
      headers: { Authorization: `Bearer ${BOT_TOKEN}` },
      signal: AbortSignal.timeout(15000),
    })
    const getData = (await getUrl.json().catch(() => null)) as { ok?: boolean; upload_url?: string; file_id?: string; error?: string } | null
    if (!getData?.ok || !getData.upload_url || !getData.file_id) {
      console.warn(`[chat-synx] files.getUploadURLExternal failed: ${getData?.error ?? 'unknown'}`)
      return null
    }

    // Step 2: PUT the bytes to upload_url. Slack expects raw bytes, not multipart.
    const put = await fetch(getData.upload_url, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(60000),
    })
    if (!put.ok) {
      console.warn(`[chat-synx] file PUT failed status=${put.status}`)
      return null
    }

    // Step 3: completeUploadExternal — attaches the file to the channel/thread.
    const completeBody: Record<string, unknown> = {
      files: [{ id: getData.file_id, title: filename }],
      channel_id: channel,
    }
    if (threadTs) completeBody.thread_ts = threadTs
    if (initialComment) completeBody.initial_comment = initialComment

    const complete = await fetch('https://slack.com/api/files.completeUploadExternal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${BOT_TOKEN}`,
      },
      body: JSON.stringify(completeBody),
      signal: AbortSignal.timeout(15000),
    })
    const completeData = (await complete.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    if (!completeData?.ok) {
      console.warn(`[chat-synx] files.completeUploadExternal failed: ${completeData?.error ?? 'unknown'}`)
      return null
    }

    console.log(`[chat-synx] uploaded file=${getData.file_id} name="${filename}" to channel=${channel}${threadTs ? ` thread=${threadTs}` : ''}`)
    return getData.file_id
  } catch (err) {
    console.warn(`[chat-synx] uploadFileToSlack threw: ${(err as Error).message}`)
    return null
  }
}

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

type BridgeFile = {
  storage_path: string
  filename: string
  mime_type: string
}

export async function bridgeHubMessageToChatSynx({
  messageId,
  roomId,
  parentId,
  senderId,
  senderName,
  senderAvatarUrl,
  content,
  files,
}: {
  messageId: string
  roomId: string | null
  parentId: string | null
  senderId: string
  senderName: string
  senderAvatarUrl: string | null
  content: string
  files?: BridgeFile[]
}): Promise<void> {
  if (!BOT_TOKEN || !roomId) return
  const hasContent = content.trim().length > 0
  const hasFiles = Array.isArray(files) && files.length > 0
  if (!hasContent && !hasFiles) return

  const admin = createAdminClient()

  const { data: bridge } = await admin
    .from('chat_synx_bridges')
    .select('slack_channel_id, company_id')
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

  // Post the text first (if any). Slack file uploads always render as the
  // bot, never with username/icon overrides — so the text post is the only
  // way to attribute attribution. For text-only messages this is the whole
  // story. For files+text, the text post lands as the user; the files land
  // as the bot in the same thread.
  let postedTs: string | null = null
  if (hasContent) {
    // Translate @firstname and @room into Slack syntax so mentions actually
    // notify Slack-side recipients. Untranslatable mentions are left as-is.
    const translated = await translateHubToSlack(content.trim(), bridge.company_id)
    const result = await postMessage({
      channel: bridge.slack_channel_id,
      text: translated,
      username,
      iconUrl,
      threadTs,
    })
    if (result.ok && result.ts) {
      postedTs = result.ts
      await admin
        .from('messages')
        .update({ slack_ts: result.ts })
        .eq('id', messageId)
      console.log(`[chat-synx] saved slack_ts=${result.ts} on message=${messageId}`)
    }
  }

  // Upload each file. If a text post was made, files thread under it. If
  // there was no text post (file-only message), files go directly into the
  // channel (or under the parent thread if this is a reply). The first file
  // also gets an initial_comment that names the sender so the bot-attribution
  // isn't confusing to teammates.
  if (hasFiles && files) {
    const fileThreadTs = postedTs ?? threadTs
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const bytes = await downloadFromR2(f.storage_path)
      if (!bytes) {
        console.warn(`[chat-synx] skipping file (R2 download failed) name="${f.filename}"`)
        continue
      }
      const initialComment = !postedTs && i === 0 ? `${username} sent an attachment` : undefined
      await uploadFileToSlack({
        channel: bridge.slack_channel_id,
        threadTs: fileThreadTs,
        filename: f.filename,
        contentType: f.mime_type || 'application/octet-stream',
        bytes,
        initialComment,
      })
    }
  }
}

// Look up the bridged Slack message for a Hub message id and resolve the
// channel id from the room's bridge. Returns null when the message wasn't
// bridged (no slack_ts), isn't in a room (DMs aren't bridged in v1), or the
// room no longer has an active bridge.
async function resolveBridgedSlackTarget(messageId: string): Promise<{ channel: string; ts: string; companyId: string } | null> {
  const admin = createAdminClient()
  const { data: msg } = await admin
    .from('messages')
    .select('slack_ts, room_id')
    .eq('id', messageId)
    .maybeSingle()
  if (!msg?.slack_ts || !msg.room_id) return null

  const { data: bridge } = await admin
    .from('chat_synx_bridges')
    .select('slack_channel_id, company_id')
    .eq('hub_room_id', msg.room_id)
    .eq('active', true)
    .maybeSingle()
  if (!bridge?.slack_channel_id) return null

  return { channel: bridge.slack_channel_id, ts: msg.slack_ts, companyId: bridge.company_id }
}

// Update the bridged Slack message's text. chat.update preserves the original
// chat:write.customize username + icon, so the edit keeps the original
// sender's attribution on the Slack side.
export async function bridgeHubEditToChatSynx(messageId: string, newContent: string): Promise<void> {
  if (!BOT_TOKEN) return
  const trimmed = newContent.trim()
  if (!trimmed) return

  const target = await resolveBridgedSlackTarget(messageId)
  if (!target) {
    console.log(`[chat-synx] edit skipped — not bridged or no active bridge message=${messageId}`)
    return
  }

  // Translate mentions in the edited content the same way the initial post does.
  const translated = await translateHubToSlack(trimmed, target.companyId)

  try {
    const res = await fetch('https://slack.com/api/chat.update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${BOT_TOKEN}`,
      },
      body: JSON.stringify({ channel: target.channel, ts: target.ts, text: translated }),
      signal: AbortSignal.timeout(8000),
    })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    if (!data?.ok) {
      console.warn(`[chat-synx] chat.update failed channel=${target.channel} ts=${target.ts} error=${data?.error ?? 'unknown'}`)
      return
    }
    console.log(`[chat-synx] edited ok channel=${target.channel} ts=${target.ts}`)
  } catch (e) {
    console.warn(`[chat-synx] chat.update threw: ${(e as Error).message}`)
  }
}

// Add a reaction on the bridged Slack message. Slack reactions are always
// attributed to the bot (chat:write.customize doesn't apply to reactions),
// so the Slack channel will show "Chat Synx reacted 👍" rather than the
// Hub user's name. Acceptable UX tradeoff; documented in Help.
export async function bridgeHubReactionAddToChatSynx(messageId: string, native: string): Promise<void> {
  if (!BOT_TOKEN) return
  const name = nativeToSlack(native)
  if (!name) {
    console.log(`[chat-synx] reaction add skipped — no Slack name for ${native}`)
    return
  }
  const target = await resolveBridgedSlackTarget(messageId)
  if (!target) return

  try {
    const res = await fetch('https://slack.com/api/reactions.add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${BOT_TOKEN}`,
      },
      body: JSON.stringify({ channel: target.channel, timestamp: target.ts, name }),
      signal: AbortSignal.timeout(8000),
    })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    // already_reacted is a no-op success; treat as ok.
    if (!data?.ok && data?.error !== 'already_reacted') {
      console.warn(`[chat-synx] reactions.add failed channel=${target.channel} ts=${target.ts} name=${name} error=${data?.error ?? 'unknown'}`)
      return
    }
    console.log(`[chat-synx] reaction added ok channel=${target.channel} ts=${target.ts} name=${name}`)
  } catch (e) {
    console.warn(`[chat-synx] reactions.add threw: ${(e as Error).message}`)
  }
}

// Remove the bot's reaction on the bridged Slack message. Note Slack scopes
// reactions.remove to the bot's own reactions — if the bot wasn't the
// reactor, this errors with no_reaction (we ignore that).
export async function bridgeHubReactionRemoveToChatSynx(messageId: string, native: string): Promise<void> {
  if (!BOT_TOKEN) return
  const name = nativeToSlack(native)
  if (!name) return
  const target = await resolveBridgedSlackTarget(messageId)
  if (!target) return

  try {
    const res = await fetch('https://slack.com/api/reactions.remove', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${BOT_TOKEN}`,
      },
      body: JSON.stringify({ channel: target.channel, timestamp: target.ts, name }),
      signal: AbortSignal.timeout(8000),
    })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    if (!data?.ok && data?.error !== 'no_reaction') {
      console.warn(`[chat-synx] reactions.remove failed channel=${target.channel} ts=${target.ts} name=${name} error=${data?.error ?? 'unknown'}`)
      return
    }
    console.log(`[chat-synx] reaction removed ok channel=${target.channel} ts=${target.ts} name=${name}`)
  } catch (e) {
    console.warn(`[chat-synx] reactions.remove threw: ${(e as Error).message}`)
  }
}

// Hard-delete the bridged Slack message. Hub keeps a soft-deleted row
// (deleted_at set), but Slack only supports hard delete — fine, the bridge
// is one-way symmetric for deletes.
export async function bridgeHubDeleteToChatSynx(messageId: string): Promise<void> {
  if (!BOT_TOKEN) return

  const target = await resolveBridgedSlackTarget(messageId)
  if (!target) {
    console.log(`[chat-synx] delete skipped — not bridged or no active bridge message=${messageId}`)
    return
  }

  try {
    const res = await fetch('https://slack.com/api/chat.delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${BOT_TOKEN}`,
      },
      body: JSON.stringify({ channel: target.channel, ts: target.ts }),
      signal: AbortSignal.timeout(8000),
    })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    if (!data?.ok) {
      console.warn(`[chat-synx] chat.delete failed channel=${target.channel} ts=${target.ts} error=${data?.error ?? 'unknown'}`)
      return
    }
    console.log(`[chat-synx] deleted ok channel=${target.channel} ts=${target.ts}`)
  } catch (e) {
    console.warn(`[chat-synx] chat.delete threw: ${(e as Error).message}`)
  }
}
