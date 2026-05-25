import { createAdminClient } from '@/lib/supabase/admin'

export const GUARDIAN_HUB_USER_ID = '00000000-0000-0000-0001-000000000001'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

/**
 * Post a message as @Guardian to a Hub room. Auto-joins Guardian as a room
 * member if not already in. Auto-unarchives any room members who'd had the
 * room hidden (rooms don't currently have per-member archive, so this is a
 * no-op today but kept symmetric with the DM helper).
 *
 * Returns the inserted message id, or null on failure (errors logged).
 */
export async function postGuardianToRoom(
  roomId: string,
  body: string,
  opts?: { admin?: SupabaseAdmin },
): Promise<string | null> {
  const admin = opts?.admin ?? createAdminClient()

  const { data: room, error: roomErr } = await admin
    .from('rooms')
    .select('id, company_id, archived_at')
    .eq('id', roomId)
    .single<{ id: string; company_id: string; archived_at: string | null }>()
  if (roomErr || !room) {
    console.error('[guardian-post] room lookup failed:', roomId, roomErr)
    return null
  }
  if (room.archived_at) {
    console.warn('[guardian-post] target room is archived, skipping:', roomId)
    return null
  }

  await admin
    .from('room_members')
    .upsert({ room_id: roomId, user_id: GUARDIAN_HUB_USER_ID, role: 'member' }, {
      onConflict: 'room_id,user_id',
      ignoreDuplicates: true,
    })

  const { data: msg, error: msgErr } = await admin
    .from('messages')
    .insert({
      company_id: room.company_id,
      room_id: roomId,
      sender_id: GUARDIAN_HUB_USER_ID,
      content: body,
    })
    .select('id')
    .single<{ id: string }>()
  if (msgErr || !msg) {
    console.error('[guardian-post] room message insert failed:', roomId, msgErr)
    return null
  }
  return msg.id
}

/**
 * Post a message as @Guardian via DM to a specific hub user. Finds the
 * 2-member (Guardian + recipient) conversation, creating it if needed,
 * and unarchives it for any member who had it archived.
 *
 * Returns the inserted message id, or null on failure (errors logged).
 */
export async function postGuardianToUserDm(
  companyId: string,
  recipientHubUserId: string,
  body: string,
  opts?: { admin?: SupabaseAdmin },
): Promise<string | null> {
  const admin = opts?.admin ?? createAdminClient()

  if (recipientHubUserId === GUARDIAN_HUB_USER_ID) return null

  const conversationId = await findOrCreateGuardianDm(admin, companyId, recipientHubUserId)
  if (!conversationId) return null

  const { data: msg, error: msgErr } = await admin
    .from('messages')
    .insert({
      company_id: companyId,
      conversation_id: conversationId,
      sender_id: GUARDIAN_HUB_USER_ID,
      content: body,
    })
    .select('id')
    .single<{ id: string }>()
  if (msgErr || !msg) {
    console.error('[guardian-post] DM message insert failed:', recipientHubUserId, msgErr)
    return null
  }

  await admin
    .from('conversation_members')
    .update({ archived_at: null })
    .eq('conversation_id', conversationId)
    .not('archived_at', 'is', null)

  return msg.id
}

/**
 * Fan out a single message to a mix of user DMs and room posts. Used by
 * features (Fleet, Daily Log, etc.) that let admins pick any combination
 * of recipients. Continues on individual failures; returns counts.
 */
export async function fanoutGuardianNotification(args: {
  companyId: string
  userIds: string[]
  roomIds: string[]
  body: string
  admin?: SupabaseAdmin
}): Promise<{ dmsSent: number; roomsPosted: number }> {
  const admin = args.admin ?? createAdminClient()
  let dmsSent = 0
  let roomsPosted = 0

  const dedupUserIds = [...new Set(args.userIds)].filter(
    (id) => id && id !== GUARDIAN_HUB_USER_ID,
  )
  for (const userId of dedupUserIds) {
    const id = await postGuardianToUserDm(args.companyId, userId, args.body, { admin })
    if (id) dmsSent++
  }

  const dedupRoomIds = [...new Set(args.roomIds)].filter((id) => !!id)
  for (const roomId of dedupRoomIds) {
    const id = await postGuardianToRoom(roomId, args.body, { admin })
    if (id) roomsPosted++
  }

  return { dmsSent, roomsPosted }
}

async function findOrCreateGuardianDm(
  admin: SupabaseAdmin,
  companyId: string,
  recipientHubUserId: string,
): Promise<string | null> {
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
      if (count === 2) return cand.conversation_id as string
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
  return conv.id
}
