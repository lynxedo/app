import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Heroes' Hub bot row — the original single-tenant constant.
 *
 * @deprecated Resolve the posting identity with `getHubBotUserId(admin, companyId)`
 * instead. This id is Heroes' bot row specifically, NOT "the bot": using it for
 * another company writes a sender_id that belongs to Heroes, and because the FK is
 * satisfied the insert succeeds — so another tenant's room shows Heroes' bot
 * posting. It survives as the seed/fallback for Heroes and for the handful of
 * places that legitimately need to recognise that specific row.
 */
export const GUARDIAN_HUB_USER_ID = '00000000-0000-0000-0001-000000000001'

/** The tenant the legacy constant belongs to (see getHubBotUserId's fallback). */
const LEGACY_BOT_COMPANY_ID =
  process.env.HUB_BOT_LEGACY_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

/**
 * The hub_users row this company's automated Hub posts are sent as.
 *
 * Reads `companies.hub_bot_user_id`, then confirms that row really is a bot of that
 * company — an id alone is not authorization, and a misconfigured column pointing at
 * a human (or at another tenant's bot) must not turn into posts under that identity.
 *
 * Returns null when the company has no bot configured. Callers must SKIP posting
 * rather than substituting a default: attributing a post to a bot row from another
 * company is worse than not posting, because it looks legitimate.
 *
 * Falls back to the legacy constant only for the tenant that constant belongs to,
 * so Heroes is unaffected even if its column is ever cleared.
 */
export async function getHubBotUserId(
  admin: SupabaseAdmin,
  companyId: string,
): Promise<string | null> {
  if (!companyId) return null

  const { data: company } = await admin
    .from('companies')
    .select('hub_bot_user_id')
    .eq('id', companyId)
    .maybeSingle<{ hub_bot_user_id: string | null }>()

  const configured = company?.hub_bot_user_id ?? null
  if (configured) {
    // Verified, not trusted: the column could point at a human or at another
    // tenant's bot, and either would otherwise become posts under that identity.
    const { data: bot } = await admin
      .from('hub_users')
      .select('id')
      .eq('id', configured)
      .eq('company_id', companyId)
      .eq('is_bot', true)
      .maybeSingle<{ id: string }>()
    if (bot) return bot.id
    console.warn(
      '[guardian-post] companies.hub_bot_user_id is not a bot of this company, ignoring:',
      { companyId, configured },
    )
  }

  if (companyId === LEGACY_BOT_COMPANY_ID) return GUARDIAN_HUB_USER_ID
  return null
}

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
  opts?: { admin?: SupabaseAdmin; parentId?: string },
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

  // Resolved from the ROOM's company, so a post always carries that company's own
  // bot. No bot configured → skip; never fall back to another tenant's identity.
  const botUserId = await getHubBotUserId(admin, room.company_id)
  if (!botUserId) {
    console.warn('[guardian-post] no Hub bot for company, skipping room post:', room.company_id)
    return null
  }

  await admin
    .from('room_members')
    .upsert({ room_id: roomId, user_id: botUserId, role: 'member' }, {
      onConflict: 'room_id,user_id',
      ignoreDuplicates: true,
    })

  const { data: msg, error: msgErr } = await admin
    .from('messages')
    .insert({
      company_id: room.company_id,
      room_id: roomId,
      sender_id: botUserId,
      content: body,
      // A reply carries BOTH room_id and parent_id: the room feed selects
      // `parent_id is null`, so a threaded reply stays out of the main feed
      // while still belonging to the room.
      parent_id: opts?.parentId ?? null,
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

  const botUserId = await getHubBotUserId(admin, companyId)
  if (!botUserId) {
    console.warn('[guardian-post] no Hub bot for company, skipping DM:', companyId)
    return null
  }
  // Never DM itself (the recipient list may include the bot).
  if (recipientHubUserId === botUserId) return null

  const conversationId = await findOrCreateGuardianDm(
    admin,
    companyId,
    recipientHubUserId,
    botUserId,
  )
  if (!conversationId) return null

  const { data: msg, error: msgErr } = await admin
    .from('messages')
    .insert({
      company_id: companyId,
      conversation_id: conversationId,
      sender_id: botUserId,
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

  // Drop this company's own bot from the recipient list so it never DMs itself.
  // (postGuardianToUserDm re-checks; this also avoids a pointless round trip.)
  const ownBotUserId = await getHubBotUserId(admin, args.companyId)
  const dedupUserIds = [...new Set(args.userIds)].filter(
    (id) => id && id !== ownBotUserId,
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
  botUserId: string,
): Promise<string | null> {
  const { data: guardianMemberships } = await admin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', botUserId)
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
    { conversation_id: conv.id, user_id: botUserId },
    { conversation_id: conv.id, user_id: recipientHubUserId },
  ])
  return conv.id
}
