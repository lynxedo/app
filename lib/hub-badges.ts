import type { SupabaseClient } from '@supabase/supabase-js'
import { sendApnsBadgeOnly } from '@/lib/hub-apns'
import { sendFcmBadgeOnly } from '@/lib/hub-fcm'

// Returns the number of unread rooms + conversations for a user.
// Matches what the sidebar counts as unread (orange dot on a row).
export async function computeUnreadCount(
  admin: SupabaseClient,
  userId: string,
  companyId: string,
): Promise<number> {
  const [stateResult, receiptsResult] = await Promise.all([
    admin.rpc('get_unread_state_for_user', {
      p_user_id: userId,
      p_company_id: companyId,
    }),
    admin
      .from('hub_read_receipts')
      .select('room_id, conversation_id, last_read_at')
      .eq('user_id', userId),
  ])

  const receiptRoomMap: Record<string, string> = {}
  const receiptConvMap: Record<string, string> = {}
  for (const r of (receiptsResult.data ?? []) as { room_id: string | null; conversation_id: string | null; last_read_at: string }[]) {
    if (r.room_id) receiptRoomMap[r.room_id] = r.last_read_at
    if (r.conversation_id) receiptConvMap[r.conversation_id] = r.last_read_at
  }

  let count = 0
  for (const row of (stateResult.data ?? []) as { scope: string; scope_id: string; last_at: string }[]) {
    if (row.scope === 'room') {
      const readAt = receiptRoomMap[row.scope_id]
      if (!readAt || row.last_at > readAt) count++
    } else if (row.scope === 'conversation') {
      const readAt = receiptConvMap[row.scope_id]
      if (!readAt || row.last_at > readAt) count++
    }
  }
  return count
}

// Fires a silent badge-only push (no alert) to all of a user's devices.
// Used by /api/hub/read-receipts POST so reading on one device updates
// the badge on the user's other devices.
export async function pushBadgeUpdate(
  admin: SupabaseClient,
  userId: string,
  companyId: string,
): Promise<void> {
  const badge = await computeUnreadCount(admin, userId, companyId)

  const [apnsRes, fcmRes] = await Promise.all([
    admin.from('apns_tokens').select('device_token').eq('user_id', userId),
    admin.from('fcm_tokens').select('device_token').eq('user_id', userId),
  ])

  const apnsTokens = (apnsRes.data ?? []).map((r: { device_token: string }) => r.device_token)
  const fcmTokens = (fcmRes.data ?? []).map((r: { device_token: string }) => r.device_token)

  if (apnsTokens.length > 0) {
    sendApnsBadgeOnly(apnsTokens, badge)
      .then(({ staleTokens }) => {
        if (staleTokens.length > 0) {
          return admin.from('apns_tokens').delete().in('device_token', staleTokens)
        }
      })
      .catch((err: Error) => console.error('[hub-badges] apns badge-clear failed:', err.message))
  }

  if (fcmTokens.length > 0) {
    sendFcmBadgeOnly(fcmTokens, badge)
      .then(({ staleTokens }) => {
        if (staleTokens.length > 0) {
          return admin.from('fcm_tokens').delete().in('device_token', staleTokens)
        }
      })
      .catch((err: Error) => console.error('[hub-badges] fcm badge-clear failed:', err.message))
  }
}
