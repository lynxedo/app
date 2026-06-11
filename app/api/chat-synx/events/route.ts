import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendHubPush } from '@/lib/hub-push'
import { slackToNative } from '@/lib/chat-synx-emoji'
import { translateSlackToHub } from '@/lib/chat-synx-mentions'

const BOT_TOKEN = process.env.CHAT_SYNX_BOT_TOKEN ?? ''
const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25 MB to match Hub upload caps for bridged files

const SIGNING_SECRET = process.env.CHAT_SYNX_SIGNING_SECRET ?? ''

function verifySignature(rawBody: string, timestamp: string, signature: string): boolean {
  if (!SIGNING_SECRET) return false
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - parseInt(timestamp, 10)) > 60 * 5) return false

  const sigBasestring = `v0:${timestamp}:${rawBody}`
  const mySig = 'v0=' + crypto.createHmac('sha256', SIGNING_SECRET).update(sigBasestring).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(mySig), Buffer.from(signature))
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const timestamp = request.headers.get('x-slack-request-timestamp') ?? ''
  const signature = request.headers.get('x-slack-signature') ?? ''
  console.log(`[chat-synx:events] incoming POST bodyLen=${rawBody.length} hasSig=${!!signature} hasTs=${!!timestamp}`)

  let payload: { type?: string; challenge?: string; event?: SlackMessageEvent; event_id?: string }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.warn('[chat-synx:events] invalid JSON body')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (payload.type === 'url_verification') {
    if (!verifySignature(rawBody, timestamp, signature)) {
      console.warn('[chat-synx:events] url_verification signature failed — check CHAT_SYNX_SIGNING_SECRET')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
    console.log('[chat-synx:events] url_verification ok')
    return NextResponse.json({ challenge: payload.challenge })
  }

  if (!verifySignature(rawBody, timestamp, signature)) {
    console.warn(`[chat-synx:events] signature failed type=${payload.type}`)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  console.log(
    `[chat-synx:events] signature ok type=${payload.type} eventType=${payload.event?.type} channel=${payload.event?.channel} channelType=${payload.event?.channel_type} user=${payload.event?.user} subtype=${payload.event?.subtype ?? '-'} botId=${payload.event?.bot_id ?? '-'} textLen=${payload.event?.text?.length ?? 0}`,
  )

  if (payload.type === 'event_callback' && payload.event) {
    await handleEvent(payload.event, payload.event_id ?? null)
  }

  return NextResponse.json({ ok: true })
}

type SlackFile = {
  id: string
  name?: string
  title?: string
  mimetype?: string
  size?: number
  url_private?: string
}

type SlackMessageEvent = {
  type: string
  subtype?: string
  bot_id?: string
  channel?: string
  channel_type?: string
  user?: string
  text?: string
  ts?: string
  thread_ts?: string
  files?: SlackFile[]
  // message_changed: the new state of the edited message lives here
  message?: { ts?: string; text?: string; user?: string; bot_id?: string }
  // message_deleted: the ts of the deleted message
  deleted_ts?: string
  // message_deleted / message_changed: prior state
  previous_message?: { ts?: string; bot_id?: string }
  // reaction_added / reaction_removed
  reaction?: string
  item?: { type?: string; channel?: string; ts?: string }
  item_user?: string
}

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

// Download a Slack-private file URL using the bot token, then upload the bytes
// to R2 and return a row matching the shape of the `files` table.
async function ingestSlackFileToR2(file: SlackFile, companyId: string): Promise<{
  storage_path: string
  filename: string
  mime_type: string
  size_bytes: number
} | { skipped: 'too_large' | 'no_url' | 'download_failed' | 'upload_failed' }> {
  if (!file.url_private) return { skipped: 'no_url' }
  if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) return { skipped: 'too_large' }

  let buffer: Buffer
  try {
    const res = await fetch(file.url_private, {
      headers: { Authorization: `Bearer ${BOT_TOKEN}` },
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      console.warn(`[chat-synx:events] file download failed status=${res.status} file_id=${file.id}`)
      return { skipped: 'download_failed' }
    }
    const arr = await res.arrayBuffer()
    if (arr.byteLength > MAX_FILE_BYTES) return { skipped: 'too_large' }
    buffer = Buffer.from(arr)
  } catch (err) {
    console.warn(`[chat-synx:events] file fetch threw: ${(err as Error).message} file_id=${file.id}`)
    return { skipped: 'download_failed' }
  }

  const filename = file.name || file.title || `slack-${file.id}`
  const ext = filename.includes('.') ? filename.split('.').pop() : 'bin'
  const key = `hub/${companyId}/chat-synx/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const mime = file.mimetype || 'application/octet-stream'

  try {
    const r2 = getR2Client()
    await r2.send(new PutObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: mime,
      ContentDisposition: `inline; filename="${encodeURIComponent(filename)}"`,
    }))
  } catch (err) {
    console.warn(`[chat-synx:events] R2 upload failed: ${(err as Error).message} file_id=${file.id}`)
    return { skipped: 'upload_failed' }
  }

  return { storage_path: key, filename, mime_type: mime, size_bytes: buffer.byteLength }
}

async function handleEvent(event: SlackMessageEvent, eventId: string | null) {
  // Reactions are top-level event types, not message subtypes.
  if (event.type === 'reaction_added') return handleReactionAdded(event)
  if (event.type === 'reaction_removed') return handleReactionRemoved(event)

  if (event.type !== 'message') return

  // Route edits and deletes to their own handlers before the regular insert path.
  if (event.subtype === 'message_changed') return handleEdit(event)
  if (event.subtype === 'message_deleted') return handleDelete(event)

  // Allow file_share through; everything else (joins, channel renames, etc.) is dropped.
  if (event.subtype && event.subtype !== 'file_share') return
  if (event.bot_id) return
  if (!event.channel || !event.user) return
  const hasFiles = Array.isArray(event.files) && event.files.length > 0
  const hasText = !!event.text && event.text.trim().length > 0
  if (!hasText && !hasFiles) return

  const admin = createAdminClient()

  const { data: bridge } = await admin
    .from('chat_synx_bridges')
    .select('id, company_id, hub_room_id')
    .eq('slack_channel_id', event.channel)
    .eq('active', true)
    .maybeSingle()
  if (!bridge) {
    console.log(`[chat-synx:events] no active bridge for channel=${event.channel}, dropping`)
    return
  }

  const { data: link } = await admin
    .from('chat_synx_user_links')
    .select('hub_user_id')
    .eq('slack_user_id', event.user)
    .maybeSingle()
  if (!link?.hub_user_id) {
    console.log(
      `[chat-synx:events] no person link for slack_user=${event.user} — add a mapping in Admin → Chat Synx → People. Dropping channel=${event.channel}`,
    )
    return
  }

  // Thread mapping: if Slack thread_ts is set, find the Hub message with that slack_ts.
  // thread_ts === ts means it's the parent of its own thread (first reply not yet shown as threaded);
  // for that case the message is top-level on Hub side too.
  let parentId: string | null = null
  if (event.thread_ts && event.thread_ts !== event.ts) {
    const { data: parent } = await admin
      .from('messages')
      .select('id')
      .eq('slack_ts', event.thread_ts)
      .maybeSingle()
    parentId = parent?.id ?? null
    if (!parentId) {
      console.log(
        `[chat-synx:events] thread parent not found for thread_ts=${event.thread_ts} — inserting as top-level (parent was likely pre-bridge)`,
      )
    }
  }

  // Translate Slack-style mentions (<@U…>, <!channel>/<!here>/<!everyone>)
  // into Hub-style @firstname / @room BEFORE insert and BEFORE the push
  // fan-out below — the fan-out scans for @firstname / @room to decide who
  // to notify, so translating up front is what makes inbound mentions
  // actually trigger Hub notifications.
  const translatedText = hasText
    ? await translateSlackToHub(event.text!.trim(), bridge.company_id)
    : ''

  const { data: inserted, error } = await admin
    .from('messages')
    .insert({
      company_id: bridge.company_id,
      room_id: bridge.hub_room_id,
      parent_id: parentId,
      sender_id: link.hub_user_id,
      content: translatedText,
      source: 'chat-synx',
      slack_event_id: eventId,
      slack_ts: event.ts ?? null,
    })
    .select('id')
    .single()

  if (error?.code === '23505') {
    console.log(`[chat-synx:events] duplicate event_id=${eventId} dropped`)
    return
  }
  if (error || !inserted) {
    console.warn(`[chat-synx:events] insert failed: ${error?.message ?? 'no row returned'}`)
    return
  }
  console.log(
    `[chat-synx:events] inserted id=${inserted.id} room=${bridge.hub_room_id} sender=${link.hub_user_id} slack_ts=${event.ts} thread_ts=${event.thread_ts ?? '-'} event_id=${eventId}${parentId ? ` parent=${parentId}` : ''}`,
  )

  // Ingest file attachments (if any) — download from Slack, upload to R2,
  // insert files rows linked to the message we just created. Skipped files
  // log a reason and are quietly dropped (no placeholder message — keeps the
  // bridge clean).
  if (hasFiles && event.files) {
    const ingested: { storage_path: string; filename: string; mime_type: string; size_bytes: number }[] = []
    for (const f of event.files) {
      const result = await ingestSlackFileToR2(f, bridge.company_id)
      if ('skipped' in result) {
        console.warn(`[chat-synx:events] file skipped reason=${result.skipped} file_id=${f.id} name=${f.name ?? '-'}`)
        continue
      }
      ingested.push(result)
    }
    if (ingested.length > 0) {
      const { error: filesError } = await admin.from('files').insert(
        ingested.map(f => ({
          company_id: bridge.company_id,
          message_id: inserted.id,
          uploader_id: link.hub_user_id,
          storage_path: f.storage_path,
          filename: f.filename,
          mime_type: f.mime_type,
          size_bytes: f.size_bytes,
        })),
      )
      if (filesError) {
        console.warn(`[chat-synx:events] files insert failed: ${filesError.message}`)
      } else {
        console.log(`[chat-synx:events] ingested ${ingested.length} file(s) for message=${inserted.id}`)
      }
    }
  }

  // Broadcast a hint to any open MessageFeed for this room AND the sidebar
  // unread indicator, as a fallback for postgres_changes (which sometimes
  // silently doesn't deliver — see Session 43.5 notes on hub_users for the
  // same pattern). The clients refetch the row by id, so we only need to
  // send the id + routing info. Safe to fire-and-forget.
  void (async () => {
    try {
      const feedChannel = admin.channel(`feed:${bridge.hub_room_id}`)
      await feedChannel.subscribe()
      await feedChannel.send({
        type: 'broadcast',
        event: 'message-inserted',
        payload: { id: inserted.id, parent_id: parentId, sender_id: link.hub_user_id },
      })
      await admin.removeChannel(feedChannel)
    } catch (err) {
      console.warn(`[chat-synx:events] feed broadcast failed: ${(err as Error).message}`)
    }
    try {
      const sidebarChannel = admin.channel('hub-sidebar-messages')
      await sidebarChannel.subscribe()
      await sidebarChannel.send({
        type: 'broadcast',
        event: 'message-inserted',
        payload: {
          id: inserted.id,
          room_id: bridge.hub_room_id,
          conversation_id: null,
          parent_id: parentId,
          sender_id: link.hub_user_id,
        },
      })
      await admin.removeChannel(sidebarChannel)
    } catch (err) {
      console.warn(`[chat-synx:events] sidebar broadcast failed: ${(err as Error).message}`)
    }
  })()

  // Skip push for thread replies (matches Hub /api/hub/messages behavior —
  // top-level messages only fan out notifications).
  if (parentId) return

  // Fan out push notifications to other company members.
  // Mirrors the room-push block in app/api/hub/messages/route.ts so
  // Slack-originated messages notify Hub users the same way Hub-originated ones do.
  try {
    const [{ data: senderProfile }, { data: roomMeta }, { data: members }, { data: roomMemberRows }] = await Promise.all([
      admin.from('hub_users').select('display_name').eq('id', link.hub_user_id).single(),
      admin.from('rooms').select('name').eq('id', bridge.hub_room_id).single(),
      admin
        .from('hub_users')
        .select('id, display_name')
        .eq('company_id', bridge.company_id)
        .neq('id', link.hub_user_id)
        .eq('is_bot', false),
      admin
        .from('room_members')
        .select('user_id')
        .eq('room_id', bridge.hub_room_id)
        .neq('user_id', link.hub_user_id),
    ])

    const senderName = senderProfile?.display_name ?? 'Someone'
    const roomName = roomMeta?.name ?? 'room'
    // Scope recipients to the room's MEMBERS only — a bridged Slack message must
    // not push to company users who aren't in this Hub room (same membership fix
    // as app/api/hub/messages/route.ts). Filtering allOthers here flows through to
    // the @mention, @room, and regular-room push paths below.
    const roomMemberIdSet = new Set((roomMemberRows ?? []).map((m: { user_id: string }) => m.user_id))
    const allOthers = ((members ?? []) as { id: string; display_name: string }[])
      .filter(u => roomMemberIdSet.has(u.id))
    // Use the mention-translated text so @firstname / @room patterns get
    // detected by the matchAll below (Slack-side <@U…> / <!channel> would
    // never match the @firstname regex otherwise).
    const text = translatedText.trim()
    const pushBody = text.length > 0 ? text.slice(0, 120) : '📎 Sent an attachment'

    // @mention push — first-name match, mirrors Hub messages route
    const mentioned = [...text.matchAll(/@(\w+)/g)].map(m => m[1].toLowerCase())
    if (mentioned.length > 0) {
      const matchedIds = allOthers
        .filter(u => mentioned.some(n => u.display_name.split(' ')[0].toLowerCase() === n))
        .map(u => u.id)
      if (matchedIds.length > 0) {
        sendHubPush(
          matchedIds,
          { title: `💬 ${senderName} mentioned you`, body: pushBody, url: `/hub/${bridge.hub_room_id}` },
          { isMention: true, roomId: bridge.hub_room_id },
        ).catch(err => console.error('[chat-synx:events] mention push failed:', err.message))
      }
    }

    // @room — force-notify all members
    if (text.toLowerCase().includes('@room')) {
      const ids = allOthers.map(u => u.id)
      if (ids.length > 0) {
        sendHubPush(
          ids,
          { title: `📢 @room — #${roomName} — ${senderName}`, body: pushBody, url: `/hub/${bridge.hub_room_id}` },
          { isMention: true, roomId: bridge.hub_room_id },
        ).catch(err => console.error('[chat-synx:events] @room push failed:', err.message))
      }
    }

    // Regular room push — sendHubPush filters by each user's mute prefs
    const ids = allOthers.map(u => u.id)
    if (ids.length > 0) {
      sendHubPush(
        ids,
        { title: `🏠 #${roomName} — ${senderName}`, body: pushBody, url: `/hub/${bridge.hub_room_id}` },
        { roomId: bridge.hub_room_id },
      ).catch(err => console.error('[chat-synx:events] room push failed:', err.message))
    }
  } catch (err) {
    console.error('[chat-synx:events] push fan-out failed:', (err as Error).message)
  }
}

// Mirror a Slack edit (message_changed) into the corresponding Hub message.
// Loop prevention: only propagate when the Hub message's source is
// 'chat-synx' — i.e., it was originally inserted from a Slack event. If
// source is 'hub' it means we posted to Slack via chat.postMessage, so any
// edit event for that ts was triggered by our own chat.update and should
// not be echoed back. Bot edits are also skipped as a belt-and-suspenders.
async function handleEdit(event: SlackMessageEvent) {
  const newTs = event.message?.ts
  const newText = event.message?.text
  if (!newTs) return
  if (event.message?.bot_id) {
    console.log(`[chat-synx:events] skipping edit on bot message ts=${newTs}`)
    return
  }

  const admin = createAdminClient()
  const { data: msg } = await admin
    .from('messages')
    .select('id, source, company_id')
    .eq('slack_ts', newTs)
    .maybeSingle()
  if (!msg) {
    console.log(`[chat-synx:events] edit dropped — no Hub message for slack_ts=${newTs}`)
    return
  }
  if (msg.source !== 'chat-synx') {
    console.log(`[chat-synx:events] edit ignored — source=${msg.source} (loop prevention) ts=${newTs}`)
    return
  }

  const trimmed = (newText ?? '').trim()
  if (!trimmed) {
    console.log(`[chat-synx:events] edit dropped — empty text ts=${newTs}`)
    return
  }

  // Mention translation — same as initial inbound insert path.
  const translated = await translateSlackToHub(trimmed, msg.company_id)

  const { error } = await admin
    .from('messages')
    .update({ content: translated, edited_at: new Date().toISOString() })
    .eq('id', msg.id)
  if (error) {
    console.warn(`[chat-synx:events] edit update failed: ${error.message}`)
    return
  }
  console.log(`[chat-synx:events] edited Hub message=${msg.id} from slack_ts=${newTs}`)
}

// Mirror a Slack reaction add into Hub. Looks up the Hub message via
// slack_ts and the reacting user via chat_synx_user_links. Loop prevention
// is implicit: when our own bot reacts (as part of Hub→Slack mirroring),
// Slack fires this event with event.user = bot_user_id, which has no user
// link, so the event drops naturally with "unmapped user."
async function handleReactionAdded(event: SlackMessageEvent) {
  const slackTs = event.item?.ts
  const slackUser = event.user
  const reaction = event.reaction
  if (!slackTs || !slackUser || !reaction) return

  const native = slackToNative(reaction)
  if (!native) {
    console.log(`[chat-synx:events] reaction_added: no native for slack name=${reaction} (likely custom emoji) — dropping`)
    return
  }

  const admin = createAdminClient()
  const [{ data: msg }, { data: link }] = await Promise.all([
    admin.from('messages').select('id').eq('slack_ts', slackTs).maybeSingle(),
    admin.from('chat_synx_user_links').select('hub_user_id').eq('slack_user_id', slackUser).maybeSingle(),
  ])
  if (!msg) {
    console.log(`[chat-synx:events] reaction_added: no Hub message for slack_ts=${slackTs}`)
    return
  }
  if (!link?.hub_user_id) {
    console.log(`[chat-synx:events] reaction_added: unmapped slack_user=${slackUser} (likely our own bot — loop prevented)`)
    return
  }

  const { error } = await admin
    .from('reactions')
    .insert({ message_id: msg.id, user_id: link.hub_user_id, emoji: native })
  // 23505 = unique violation; the reaction already exists on Hub (likely from
  // a fast re-fire of the event). Safe to ignore.
  if (error && error.code !== '23505') {
    console.warn(`[chat-synx:events] reaction_added insert failed: ${error.message}`)
    return
  }
  console.log(`[chat-synx:events] reaction added on Hub message=${msg.id} user=${link.hub_user_id} emoji=${native}`)
}

async function handleReactionRemoved(event: SlackMessageEvent) {
  const slackTs = event.item?.ts
  const slackUser = event.user
  const reaction = event.reaction
  if (!slackTs || !slackUser || !reaction) return

  const native = slackToNative(reaction)
  if (!native) return

  const admin = createAdminClient()
  const [{ data: msg }, { data: link }] = await Promise.all([
    admin.from('messages').select('id').eq('slack_ts', slackTs).maybeSingle(),
    admin.from('chat_synx_user_links').select('hub_user_id').eq('slack_user_id', slackUser).maybeSingle(),
  ])
  if (!msg || !link?.hub_user_id) return

  const { error } = await admin
    .from('reactions')
    .delete()
    .eq('message_id', msg.id)
    .eq('user_id', link.hub_user_id)
    .eq('emoji', native)
  if (error) {
    console.warn(`[chat-synx:events] reaction_removed delete failed: ${error.message}`)
    return
  }
  console.log(`[chat-synx:events] reaction removed on Hub message=${msg.id} user=${link.hub_user_id} emoji=${native}`)
}

// Mirror a Slack delete (message_deleted) into the corresponding Hub message
// via soft-delete. Same loop-prevention rule as edits.
async function handleDelete(event: SlackMessageEvent) {
  const deletedTs = event.deleted_ts
  if (!deletedTs) return
  if (event.previous_message?.bot_id) {
    console.log(`[chat-synx:events] skipping delete on bot message ts=${deletedTs}`)
    return
  }

  const admin = createAdminClient()
  const { data: msg } = await admin
    .from('messages')
    .select('id, source')
    .eq('slack_ts', deletedTs)
    .maybeSingle()
  if (!msg) {
    console.log(`[chat-synx:events] delete dropped — no Hub message for slack_ts=${deletedTs}`)
    return
  }
  if (msg.source !== 'chat-synx') {
    console.log(`[chat-synx:events] delete ignored — source=${msg.source} (loop prevention) ts=${deletedTs}`)
    return
  }

  const { error } = await admin
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', msg.id)
  if (error) {
    console.warn(`[chat-synx:events] delete update failed: ${error.message}`)
    return
  }
  console.log(`[chat-synx:events] soft-deleted Hub message=${msg.id} from slack_ts=${deletedTs}`)
}
