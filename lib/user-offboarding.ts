import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// Where a deactivated teammate's Txt conversations are transferred (Heroes: Ben).
const TXT_TRANSFER_USER_ID =
  process.env.OFFBOARD_TXT_TRANSFER_USER_ID || '6939b706-5135-448d-a28a-7674ba17974e'

// Supabase has no permanent ban flag — a ~100-year duration is the idiom.
const BAN_FOREVER = '876000h'

// Blocks (or restores) sign-in at the auth layer. A banned user can't sign in
// or refresh their session; their current access token dies within the hour.
// The immediate UI lockout comes from the locked_at check in the Hub layout.
export async function setAuthBan(admin: Admin, userId: string, banned: boolean) {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: banned ? BAN_FOREVER : 'none',
  })
  if (error) throw new Error(`Could not ${banned ? 'lock' : 'unlock'} sign-in: ${error.message}`)
}

// Push notifications stop the moment the tokens are gone. Devices re-register
// on next sign-in, so this is safe to run on lock (reversible).
export async function clearPushTokens(admin: Admin, userId: string) {
  await Promise.all([
    admin.from('push_subscriptions').delete().eq('user_id', userId),
    admin.from('apns_tokens').delete().eq('user_id', userId),
    admin.from('fcm_tokens').delete().eq('user_id', userId),
  ])
}

// Reassigns every Txt conversation the user owns to the transfer target, with
// the same bookkeeping as the /assign route (owner member row + assigned_to).
export async function transferTxtConversations(
  admin: Admin,
  fromUserId: string,
  actedBy: string,
): Promise<number> {
  const toUserId = TXT_TRANSFER_USER_ID
  if (!toUserId || toUserId === fromUserId) return 0

  const { data: convos } = await admin
    .from('txt_conversations')
    .select('id')
    .eq('assigned_to', fromUserId)
  const ids = (convos ?? []).map((c: { id: string }) => c.id)

  for (const id of ids) {
    await admin
      .from('txt_conversation_members')
      .delete()
      .eq('conversation_id', id)
      .eq('role', 'owner')
    await admin
      .from('txt_conversation_members')
      .delete()
      .match({ conversation_id: id, user_id: toUserId })
    await admin.from('txt_conversation_members').insert({
      conversation_id: id,
      user_id: toUserId,
      role: 'owner',
      added_by: actedBy,
    })
    await admin
      .from('txt_conversations')
      .update({ assigned_to: toUserId, status: 'assigned' })
      .eq('id', id)
  }
  return ids.length
}
