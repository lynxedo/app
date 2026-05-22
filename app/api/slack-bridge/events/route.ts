import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? ''

function verifySlackSignature(rawBody: string, timestamp: string, signature: string): boolean {
  if (!SLACK_SIGNING_SECRET) return false
  // Reject requests older than 5 minutes (replay protection)
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - parseInt(timestamp, 10)) > 60 * 5) return false

  const sigBasestring = `v0:${timestamp}:${rawBody}`
  const mySig = 'v0=' + crypto
    .createHmac('sha256', SLACK_SIGNING_SECRET)
    .update(sigBasestring)
    .digest('hex')

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
  console.log(`[slack-bridge:events] incoming POST bodyLen=${rawBody.length} hasSig=${!!signature} hasTs=${!!timestamp}`)

  let payload: { type?: string; challenge?: string; event?: SlackMessageEvent }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.warn('[slack-bridge:events] invalid JSON body')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // url_verification — handshake during Slack app setup. Verify signature too.
  if (payload.type === 'url_verification') {
    if (!verifySlackSignature(rawBody, timestamp, signature)) {
      console.warn('[slack-bridge:events] url_verification signature failed')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
    console.log('[slack-bridge:events] url_verification ok')
    return NextResponse.json({ challenge: payload.challenge })
  }

  // All other events require signature verification
  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    console.warn(`[slack-bridge:events] signature failed type=${payload.type}`)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  console.log(`[slack-bridge:events] signature ok type=${payload.type} eventType=${payload.event?.type} channel=${payload.event?.channel} channelType=${payload.event?.channel_type} user=${payload.event?.user} subtype=${payload.event?.subtype ?? '-'} botId=${payload.event?.bot_id ?? '-'} textLen=${payload.event?.text?.length ?? 0}`)

  if (payload.type === 'event_callback' && payload.event) {
    await handleEvent(payload.event)
  }

  return NextResponse.json({ ok: true })
}

type SlackMessageEvent = {
  type: string
  subtype?: string
  bot_id?: string
  channel?: string
  channel_type?: string  // 'im' for DM, 'channel' for public channel
  user?: string          // Slack user ID
  text?: string
  ts?: string
  thread_ts?: string
}

async function handleEvent(event: SlackMessageEvent) {
  if (event.type !== 'message') return
  // Ignore bot messages, edits, deletes, channel joins, etc. — only fresh user text messages
  if (event.subtype) return
  if (event.bot_id) return
  if (!event.text || !event.text.trim()) return

  const admin = createAdminClient()

  // Look up bridge: DM (im) → match by slack_user_id; channel → match by slack_channel_id
  let bridge: BridgeRow | null = null

  if (event.channel_type === 'im' && event.user) {
    const { data } = await admin
      .from('slack_bridges')
      .select('id, company_id, bridge_type, hub_user_id, hub_room_id')
      .eq('bridge_type', 'dm')
      .eq('slack_user_id', event.user)
      .eq('active', true)
      .maybeSingle()
    bridge = data as BridgeRow | null
  } else if (event.channel) {
    const { data } = await admin
      .from('slack_bridges')
      .select('id, company_id, bridge_type, hub_user_id, hub_room_id')
      .eq('bridge_type', 'room')
      .eq('slack_channel_id', event.channel)
      .eq('active', true)
      .maybeSingle()
    bridge = data as BridgeRow | null
  }

  if (!bridge) {
    console.log(`[slack-bridge:events] no bridge for channel=${event.channel} channelType=${event.channel_type} user=${event.user}, dropping`)
    return
  }

  // Resolve the Hub sender id.
  // - For DM bridges: bridge.hub_user_id IS the sender (one-to-one mapping).
  // - For room bridges: hub_user_id is null on the bridge row; look up the sender's Hub
  //   identity by their Slack user id via the DM bridge table.
  let senderHubId: string | null = bridge.hub_user_id ?? null
  if (bridge.bridge_type === 'room' && event.user) {
    const { data: senderBridge } = await admin
      .from('slack_bridges')
      .select('hub_user_id')
      .eq('bridge_type', 'dm')
      .eq('slack_user_id', event.user)
      .eq('active', true)
      .maybeSingle()
    senderHubId = senderBridge?.hub_user_id ?? null
  }
  if (!senderHubId) {
    console.log(`[slack-bridge:events] no Hub identity for Slack user=${event.user} (need an active DM bridge mapping their slack_user_id → a hub_user_id), dropping`)
    return
  }

  if (bridge.bridge_type === 'room' && bridge.hub_room_id) {
    const { error } = await admin.from('messages').insert({
      company_id: bridge.company_id,
      room_id: bridge.hub_room_id,
      sender_id: senderHubId,
      content: event.text.trim(),
      source: 'slack',
    })
    if (error) console.warn(`[slack-bridge:events] room insert failed: ${error.message}`)
    else console.log(`[slack-bridge:events] room message inserted room=${bridge.hub_room_id} sender=${senderHubId}`)
  } else if (bridge.bridge_type === 'dm' && bridge.hub_user_id) {
    // For DMs, find the conversation the bridged user is in that has the most recent
    // message activity. (1-on-1 DM with the admin who set up the bridge is the typical case.)
    const { data: convs } = await admin
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', bridge.hub_user_id)
    const convIds = (convs ?? []).map((c: { conversation_id: string }) => c.conversation_id)
    if (convIds.length === 0) return

    const { data: latestMsg } = await admin
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', convIds)
      .is('parent_id', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Fallback: if there's no message history, just pick the newest conversation
    let conversationId = latestMsg?.conversation_id
    if (!conversationId) {
      const { data: newestConv } = await admin
        .from('conversations')
        .select('id')
        .in('id', convIds)
        .eq('company_id', bridge.company_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      conversationId = newestConv?.id
    }
    if (!conversationId) return

    await admin.from('messages').insert({
      company_id: bridge.company_id,
      conversation_id: conversationId,
      sender_id: bridge.hub_user_id,
      content: event.text.trim(),
      source: 'slack',
    })

    // Auto-unarchive the DM for all members on new activity
    await admin
      .from('conversation_members')
      .update({ archived_at: null })
      .eq('conversation_id', conversationId)
      .not('archived_at', 'is', null)
  }
}

type BridgeRow = {
  id: string
  company_id: string
  bridge_type: 'dm' | 'room'
  hub_user_id: string | null
  hub_room_id: string | null
}
