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

  let payload: { type?: string; challenge?: string; event?: SlackMessageEvent; event_id?: string }
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
    await handleEvent(payload.event, payload.event_id ?? null)
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

async function handleEvent(event: SlackMessageEvent, eventId: string | null) {
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
      .select('id, company_id, bridge_type, hub_user_id, hub_room_id, partner_hub_user_id')
      .eq('bridge_type', 'dm')
      .eq('slack_user_id', event.user)
      .eq('active', true)
      .maybeSingle()
    bridge = data as BridgeRow | null
  } else if (event.channel) {
    const { data } = await admin
      .from('slack_bridges')
      .select('id, company_id, bridge_type, hub_user_id, hub_room_id, partner_hub_user_id')
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
      slack_event_id: eventId,
    })
    if (error?.code === '23505') console.log(`[slack-bridge:events] duplicate event_id=${eventId} dropped (room)`)
    else if (error) console.warn(`[slack-bridge:events] room insert failed: ${error.message}`)
    else console.log(`[slack-bridge:events] room message inserted room=${bridge.hub_room_id} sender=${senderHubId} event_id=${eventId}`)
  } else if (bridge.bridge_type === 'dm' && bridge.hub_user_id) {
    // Route this Slack DM to the 1-on-1 Hub conversation between the bridged
    // user (hubX) and the bridge's configured partner. Self-DM when they match.
    const hubX = bridge.hub_user_id
    const partner = bridge.partner_hub_user_id
    if (!partner) {
      console.warn(`[slack-bridge:events] DM bridge ${bridge.id} has no partner_hub_user_id, dropping`)
      return
    }

    const conversationId = await findOrCreateDmConversation(admin, bridge.company_id, hubX, partner)
    if (!conversationId) {
      console.warn(`[slack-bridge:events] could not find/create DM hubX=${hubX} partner=${partner}, dropping`)
      return
    }

    const { error: dmInsertError } = await admin.from('messages').insert({
      company_id: bridge.company_id,
      conversation_id: conversationId,
      sender_id: hubX,
      content: event.text.trim(),
      source: 'slack',
      slack_event_id: eventId,
    })
    if (dmInsertError?.code === '23505') {
      console.log(`[slack-bridge:events] duplicate event_id=${eventId} dropped (dm)`)
      return  // Skip auto-unarchive too — already processed
    }
    if (dmInsertError) {
      console.warn(`[slack-bridge:events] DM insert failed: ${dmInsertError.message}`)
      return
    }
    console.log(`[slack-bridge:events] DM message inserted conversation=${conversationId} sender=${hubX} partner=${partner} event_id=${eventId}`)

    // Auto-unarchive the DM for all members on new activity
    await admin
      .from('conversation_members')
      .update({ archived_at: null })
      .eq('conversation_id', conversationId)
      .not('archived_at', 'is', null)
  }
}

// Find or create a 1-on-1 DM between two Hub users. If they match, returns the
// caller's canonical self-DM.
async function findOrCreateDmConversation(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  userA: string,
  userB: string,
): Promise<string | null> {
  if (userA === userB) {
    return ensureSelfConversation(admin, companyId, userA)
  }

  // Find a conversation whose member set equals exactly {userA, userB}.
  const { data: aMemberships } = await admin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userA)
  const aConvIds = (aMemberships ?? []).map((m: { conversation_id: string }) => m.conversation_id)
  if (aConvIds.length > 0) {
    const { data: allMembers } = await admin
      .from('conversation_members')
      .select('conversation_id, user_id')
      .in('conversation_id', aConvIds)
    const byConv: Record<string, string[]> = {}
    for (const m of (allMembers ?? []) as { conversation_id: string; user_id: string }[]) {
      ;(byConv[m.conversation_id] ??= []).push(m.user_id)
    }
    const target = [userA, userB].sort()
    for (const [cid, members] of Object.entries(byConv)) {
      const sorted = [...members].sort()
      if (sorted.length === 2 && sorted[0] === target[0] && sorted[1] === target[1]) {
        // Unarchive for the partner so the message is visible
        await admin
          .from('conversation_members')
          .update({ archived_at: null })
          .eq('conversation_id', cid)
          .eq('user_id', userB)
        return cid
      }
    }
  }

  // Not found — create a new 2-member DM
  const { data: conv, error: convErr } = await admin
    .from('conversations')
    .insert({ company_id: companyId })
    .select('id')
    .single()
  if (convErr || !conv) {
    console.warn(`[slack-bridge:events] DM create failed: ${convErr?.message}`)
    return null
  }
  const { error: memberErr } = await admin
    .from('conversation_members')
    .insert([
      { conversation_id: conv.id, user_id: userA },
      { conversation_id: conv.id, user_id: userB },
    ])
  if (memberErr) {
    console.warn(`[slack-bridge:events] DM member insert failed: ${memberErr.message}`)
    return null
  }
  console.log(`[slack-bridge:events] created new DM conversation=${conv.id} members=${userA},${userB}`)
  return conv.id
}

// Mirrors the helper in /api/hub/conversations — finds or creates the canonical
// self-DM (single-member conversation) for the given user.
async function ensureSelfConversation(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  userId: string,
): Promise<string | null> {
  const { data: mine } = await admin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userId)
  const myIds = (mine ?? []).map((m: { conversation_id: string }) => m.conversation_id)
  if (myIds.length > 0) {
    const { data: peers } = await admin
      .from('conversation_members')
      .select('conversation_id, user_id')
      .in('conversation_id', myIds)
    const counts: Record<string, number> = {}
    for (const p of (peers ?? []) as { conversation_id: string; user_id: string }[]) {
      counts[p.conversation_id] = (counts[p.conversation_id] ?? 0) + 1
    }
    const candidates = myIds.filter((cid) => counts[cid] === 1)
    if (candidates.length > 0) {
      const { data: ordered } = await admin
        .from('conversations')
        .select('id, created_at')
        .in('id', candidates)
        .order('created_at', { ascending: true })
        .limit(1)
      const winner = ordered?.[0]?.id ?? candidates[0]
      await admin
        .from('conversation_members')
        .update({ archived_at: null })
        .eq('conversation_id', winner)
        .eq('user_id', userId)
      return winner
    }
  }
  const { data: conv, error } = await admin
    .from('conversations')
    .insert({ company_id: companyId })
    .select('id')
    .single()
  if (error || !conv) return null
  await admin
    .from('conversation_members')
    .insert({ conversation_id: conv.id, user_id: userId })
  return conv.id
}

type BridgeRow = {
  id: string
  company_id: string
  bridge_type: 'dm' | 'room'
  hub_user_id: string | null
  hub_room_id: string | null
  partner_hub_user_id: string | null
}
