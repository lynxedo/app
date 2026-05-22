import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendHubPush } from '@/lib/hub-push'

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
}

async function handleEvent(event: SlackMessageEvent, eventId: string | null) {
  if (event.type !== 'message') return
  if (event.subtype) return
  if (event.bot_id) return
  if (!event.text || !event.text.trim()) return
  if (!event.channel || !event.user) return

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
      `[chat-synx:events] no person link for slack_user=${event.user} — add a mapping in Admin → Chat Synx → People. Dropping channel=${event.channel} text="${event.text.slice(0, 60)}…"`,
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

  const { data: inserted, error } = await admin
    .from('messages')
    .insert({
      company_id: bridge.company_id,
      room_id: bridge.hub_room_id,
      parent_id: parentId,
      sender_id: link.hub_user_id,
      content: event.text.trim(),
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

  // Broadcast a hint to any open MessageFeed for this room as a fallback for
  // postgres_changes (which sometimes silently doesn't deliver — see
  // Session 43.5 notes on hub_users for the same pattern). The client refetches
  // the row by id, so we only need to send the id. Safe to fire-and-forget.
  void (async () => {
    try {
      const channel = admin.channel(`feed:${bridge.hub_room_id}`)
      await channel.subscribe()
      await channel.send({
        type: 'broadcast',
        event: 'message-inserted',
        payload: { id: inserted.id, parent_id: parentId, sender_id: link.hub_user_id },
      })
      await admin.removeChannel(channel)
    } catch (err) {
      console.warn(`[chat-synx:events] broadcast failed: ${(err as Error).message}`)
    }
  })()

  // Skip push for thread replies (matches Hub /api/hub/messages behavior —
  // top-level messages only fan out notifications).
  if (parentId) return

  // Fan out push notifications to other company members.
  // Mirrors the room-push block in app/api/hub/messages/route.ts so
  // Slack-originated messages notify Hub users the same way Hub-originated ones do.
  try {
    const [{ data: senderProfile }, { data: roomMeta }, { data: members }] = await Promise.all([
      admin.from('hub_users').select('display_name').eq('id', link.hub_user_id).single(),
      admin.from('rooms').select('name').eq('id', bridge.hub_room_id).single(),
      admin
        .from('hub_users')
        .select('id, display_name')
        .eq('company_id', bridge.company_id)
        .neq('id', link.hub_user_id)
        .eq('is_bot', false),
    ])

    const senderName = senderProfile?.display_name ?? 'Someone'
    const roomName = roomMeta?.name ?? 'room'
    const allOthers = (members ?? []) as { id: string; display_name: string }[]
    const text = event.text.trim()

    // @mention push — first-name match, mirrors Hub messages route
    const mentioned = [...text.matchAll(/@(\w+)/g)].map(m => m[1].toLowerCase())
    if (mentioned.length > 0) {
      const matchedIds = allOthers
        .filter(u => mentioned.some(n => u.display_name.split(' ')[0].toLowerCase() === n))
        .map(u => u.id)
      if (matchedIds.length > 0) {
        sendHubPush(
          matchedIds,
          { title: `${senderName} mentioned you`, body: text.slice(0, 120), url: `/hub/${bridge.hub_room_id}` },
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
          { title: `📢 @room — #${roomName} — ${senderName}`, body: text.slice(0, 120), url: `/hub/${bridge.hub_room_id}` },
          { isMention: true, roomId: bridge.hub_room_id },
        ).catch(err => console.error('[chat-synx:events] @room push failed:', err.message))
      }
    }

    // Regular room push — sendHubPush filters by each user's mute prefs
    const ids = allOthers.map(u => u.id)
    if (ids.length > 0) {
      sendHubPush(
        ids,
        { title: `#${roomName} — ${senderName}`, body: text.slice(0, 120), url: `/hub/${bridge.hub_room_id}` },
        { roomId: bridge.hub_room_id },
      ).catch(err => console.error('[chat-synx:events] room push failed:', err.message))
    }
  } catch (err) {
    console.error('[chat-synx:events] push fan-out failed:', (err as Error).message)
  }
}
