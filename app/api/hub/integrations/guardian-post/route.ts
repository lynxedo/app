import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GUARDIAN_HUB_USER_ID } from '@/lib/guardian-post'
import { sendHubPush } from '@/lib/hub-push'

export const dynamic = 'force-dynamic'

// Internal endpoint used by the Jobber MCP server to post messages as
// @Guardian into Hub. Mirrors the insert+broadcast+push fan-out that
// /api/hub/messages does for real users, so MCP-originated messages fire
// push notifications the same way Hub-originated ones do.
//
// Auth: `x-guardian-post-secret` header must equal env GUARDIAN_POST_SECRET.
//
// Body (exactly one of room_id / recipient_user_id / conversation_id required):
//   { room_id, body, parent_id? }              — post to a room
//   { recipient_user_id, body, parent_id? }    — DM a specific user (Guardian↔user conv created if missing)
//   { conversation_id, body, parent_id? }      — post to an existing DM conversation
export async function POST(request: Request) {
  const secret = request.headers.get('x-guardian-post-secret')
  if (!secret || secret !== process.env.GUARDIAN_POST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: {
    body?: unknown
    room_id?: unknown
    recipient_user_id?: unknown
    conversation_id?: unknown
    parent_id?: unknown
  }
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const body = typeof payload.body === 'string' ? payload.body.trim() : ''
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 })

  const roomId = typeof payload.room_id === 'string' && payload.room_id ? payload.room_id : null
  const recipientUserId =
    typeof payload.recipient_user_id === 'string' && payload.recipient_user_id
      ? payload.recipient_user_id
      : null
  const conversationIdIn =
    typeof payload.conversation_id === 'string' && payload.conversation_id
      ? payload.conversation_id
      : null
  const parentId =
    typeof payload.parent_id === 'string' && payload.parent_id ? payload.parent_id : null

  const targetCount = [roomId, recipientUserId, conversationIdIn].filter(Boolean).length
  if (targetCount !== 1) {
    return NextResponse.json(
      { error: 'exactly one of room_id, recipient_user_id, or conversation_id required' },
      { status: 400 },
    )
  }

  const admin = createAdminClient()

  // ── Room path ────────────────────────────────────────────────
  if (roomId) {
    const { data: room } = await admin
      .from('rooms')
      .select('id, name, company_id, archived_at')
      .eq('id', roomId)
      .maybeSingle<{ id: string; name: string; company_id: string; archived_at: string | null }>()
    if (!room) {
      return NextResponse.json({ error: 'room not found' }, { status: 404 })
    }
    if (room.archived_at) {
      return NextResponse.json({ error: 'room is archived' }, { status: 409 })
    }

    await admin
      .from('room_members')
      .upsert({ room_id: room.id, user_id: GUARDIAN_HUB_USER_ID, role: 'member' }, {
        onConflict: 'room_id,user_id',
        ignoreDuplicates: true,
      })

    const { data: msg, error } = await admin
      .from('messages')
      .insert({
        company_id: room.company_id,
        room_id: room.id,
        sender_id: GUARDIAN_HUB_USER_ID,
        content: body,
        parent_id: parentId,
      })
      .select('id')
      .single<{ id: string }>()
    if (error || !msg) {
      return NextResponse.json(
        { error: error?.message ?? 'insert failed' },
        { status: 500 },
      )
    }

    fireBroadcasts(admin, { messageId: msg.id, roomId: room.id, conversationId: null, parentId, senderId: GUARDIAN_HUB_USER_ID })
    if (!parentId) {
      fireRoomPush(admin, { companyId: room.company_id, roomId: room.id, roomName: room.name, body })
    }

    return NextResponse.json({ ok: true, message_id: msg.id })
  }

  // ── DM path: resolve or create conversation ─────────────────
  let conversationId: string
  let createdConv = false
  let companyId: string

  if (recipientUserId) {
    if (recipientUserId === GUARDIAN_HUB_USER_ID) {
      return NextResponse.json({ error: 'cannot DM Guardian itself' }, { status: 400 })
    }
    const { data: recipient } = await admin
      .from('hub_users')
      .select('id, company_id')
      .eq('id', recipientUserId)
      .maybeSingle<{ id: string; company_id: string }>()
    if (!recipient) {
      return NextResponse.json({ error: 'recipient_user_id not found' }, { status: 404 })
    }
    companyId = recipient.company_id

    const resolved = await findOrCreateGuardianDm(admin, companyId, recipientUserId)
    if (!resolved) {
      return NextResponse.json({ error: 'conversation create failed' }, { status: 500 })
    }
    conversationId = resolved.conversationId
    createdConv = resolved.created
  } else {
    conversationId = conversationIdIn!
    const { data: conv } = await admin
      .from('conversations')
      .select('id, company_id')
      .eq('id', conversationId)
      .maybeSingle<{ id: string; company_id: string }>()
    if (!conv) {
      return NextResponse.json({ error: 'conversation_id not found' }, { status: 404 })
    }
    companyId = conv.company_id
  }

  const { data: msg, error } = await admin
    .from('messages')
    .insert({
      company_id: companyId,
      conversation_id: conversationId,
      sender_id: GUARDIAN_HUB_USER_ID,
      content: body,
      parent_id: parentId,
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !msg) {
    return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 })
  }

  // Unarchive for any member who had it archived (matches /api/hub/messages)
  await admin
    .from('conversation_members')
    .update({ archived_at: null })
    .eq('conversation_id', conversationId)
    .not('archived_at', 'is', null)

  fireBroadcasts(admin, { messageId: msg.id, roomId: null, conversationId, parentId, senderId: GUARDIAN_HUB_USER_ID })
  if (!parentId) {
    fireDmPush(admin, { conversationId, body })
  }

  return NextResponse.json({
    ok: true,
    message_id: msg.id,
    conversation_id: conversationId,
    created_conv: createdConv,
  })
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

type SupabaseAdmin = ReturnType<typeof createAdminClient>

async function findOrCreateGuardianDm(
  admin: SupabaseAdmin,
  companyId: string,
  recipientHubUserId: string,
): Promise<{ conversationId: string; created: boolean } | null> {
  const { data: guardianMemberships } = await admin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', GUARDIAN_HUB_USER_ID)
  const guardianConvIds = (guardianMemberships ?? []).map(
    (m: { conversation_id: string }) => m.conversation_id,
  )

  if (guardianConvIds.length > 0) {
    const { data: candidates } = await admin
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', recipientHubUserId)
      .in('conversation_id', guardianConvIds)
    for (const cand of candidates ?? []) {
      const { count } = await admin
        .from('conversation_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('conversation_id', cand.conversation_id)
      if (count === 2) {
        return { conversationId: cand.conversation_id as string, created: false }
      }
    }
  }

  const { data: conv, error } = await admin
    .from('conversations')
    .insert({ company_id: companyId })
    .select('id')
    .single<{ id: string }>()
  if (error || !conv) {
    console.error('[guardian-post] conversation create failed:', error)
    return null
  }
  await admin.from('conversation_members').insert([
    { conversation_id: conv.id, user_id: GUARDIAN_HUB_USER_ID },
    { conversation_id: conv.id, user_id: recipientHubUserId },
  ])
  return { conversationId: conv.id, created: true }
}

// Realtime fallback broadcasts so open Hub clients show the message + flip
// the sidebar unread badge without waiting on postgres_changes (same pattern
// as the Chat Synx events route and other admin-client insert paths).
function fireBroadcasts(
  admin: SupabaseAdmin,
  args: {
    messageId: string
    roomId: string | null
    conversationId: string | null
    parentId: string | null
    senderId: string
  },
) {
  void (async () => {
    const feedKey = args.roomId ? `feed:${args.roomId}` : `feed:${args.conversationId}`
    try {
      const feed = admin.channel(feedKey)
      await feed.subscribe()
      await feed.send({
        type: 'broadcast',
        event: 'message-inserted',
        payload: { id: args.messageId, parent_id: args.parentId, sender_id: args.senderId },
      })
      await admin.removeChannel(feed)
    } catch (err) {
      console.warn(`[guardian-post] feed broadcast failed: ${(err as Error).message}`)
    }
    try {
      const sidebar = admin.channel('hub-sidebar-messages')
      await sidebar.subscribe()
      await sidebar.send({
        type: 'broadcast',
        event: 'message-inserted',
        payload: {
          id: args.messageId,
          room_id: args.roomId,
          conversation_id: args.conversationId,
          parent_id: args.parentId,
          sender_id: args.senderId,
        },
      })
      await admin.removeChannel(sidebar)
    } catch (err) {
      console.warn(`[guardian-post] sidebar broadcast failed: ${(err as Error).message}`)
    }
  })()
}

// Room push fan-out — mirrors the room block in /api/hub/messages.
// sendHubPush filters by each user's notification prefs (muted/mentions/all).
async function fireRoomPush(
  admin: SupabaseAdmin,
  args: { companyId: string; roomId: string; roomName: string; body: string },
) {
  try {
    const { data: members } = await admin
      .from('hub_users')
      .select('id, display_name')
      .eq('company_id', args.companyId)
      .neq('id', GUARDIAN_HUB_USER_ID)
      .eq('is_bot', false)

    const all = (members ?? []) as { id: string; display_name: string }[]
    const previewText = args.body.trim()
    const pushBody = previewText.length > 0 ? previewText.slice(0, 120) : '📎 Sent an attachment'

    // @mention push
    const mentioned = [...previewText.matchAll(/@(\w+)/g)].map(m => m[1].toLowerCase())
    if (mentioned.length > 0) {
      const matchedIds = all
        .filter(u => mentioned.some(n => u.display_name.split(' ')[0].toLowerCase() === n))
        .map(u => u.id)
      if (matchedIds.length > 0) {
        sendHubPush(
          matchedIds,
          { title: `Guardian mentioned you`, body: pushBody, url: `/hub/${args.roomId}` },
          { isMention: true, roomId: args.roomId },
        ).catch(err => console.error('[guardian-post] mention push failed:', err.message))
      }
    }

    // @room force-notify
    if (previewText.toLowerCase().includes('@room')) {
      const ids = all.map(u => u.id)
      if (ids.length > 0) {
        sendHubPush(
          ids,
          {
            title: `📢 @room — #${args.roomName} — Guardian`,
            body: pushBody,
            url: `/hub/${args.roomId}`,
          },
          { isMention: true, roomId: args.roomId },
        ).catch(err => console.error('[guardian-post] @room push failed:', err.message))
      }
    }

    // Regular room push
    const ids = all.map(u => u.id)
    if (ids.length > 0) {
      sendHubPush(
        ids,
        { title: `#${args.roomName} — Guardian`, body: pushBody, url: `/hub/${args.roomId}` },
        { roomId: args.roomId },
      ).catch(err => console.error('[guardian-post] room push failed:', err.message))
    }
  } catch (err) {
    console.error('[guardian-post] room push fan-out failed:', (err as Error).message)
  }
}

// DM push fan-out — mirrors the conversation block in /api/hub/messages.
// isDm:true bypasses the global "mentions only" filter but respects DND + muted.
async function fireDmPush(
  admin: SupabaseAdmin,
  args: { conversationId: string; body: string },
) {
  try {
    const { data: members } = await admin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', args.conversationId)
      .neq('user_id', GUARDIAN_HUB_USER_ID)

    const recipientIds = (members ?? []).map((m: { user_id: string }) => m.user_id)
    if (recipientIds.length === 0) return

    const previewText = args.body.trim()
    const pushBody = previewText.length > 0 ? previewText.slice(0, 120) : '📎 Sent an attachment'

    sendHubPush(
      recipientIds,
      { title: 'Guardian', body: pushBody, url: `/hub/pm/${args.conversationId}` },
      { isDm: true },
    ).catch(err => console.error('[guardian-post] DM push failed:', err.message))
  } catch (err) {
    console.error('[guardian-post] DM push fan-out failed:', (err as Error).message)
  }
}
