import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendApnsPush } from '@/lib/hub-apns'
import { sendFcmPush } from '@/lib/hub-fcm'

let vapidConfigured = false

function ensureVapid() {
  if (vapidConfigured) return
  const pubKey = process.env.HUB_VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_HUB_VAPID_PUBLIC_KEY
  const privKey = process.env.HUB_VAPID_PRIVATE_KEY
  if (!pubKey || !privKey) return
  webpush.setVapidDetails(
    `mailto:${process.env.HUB_VAPID_EMAIL ?? 'ben@heroeslawntx.com'}`,
    pubKey,
    privKey,
  )
  vapidConfigured = true
}

interface PushOptions {
  isMention?: boolean   // true when this push is an @mention (bypasses most DND)
  isDm?: boolean        // true for DM messages — bypasses mentions-level filter but not muted/DND
  roomId?: string | null  // room context for per-room mute checks
}

export async function sendHubPush(
  userIds: string[],
  payload: { title: string; body: string; url: string },
  options: PushOptions = {}
) {
  const pubKey = process.env.HUB_VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_HUB_VAPID_PUBLIC_KEY
  if (!pubKey || userIds.length === 0) return

  ensureVapid()

  const admin = createAdminClient()
  const { isMention = false, isDm = false, roomId = null } = options

  // Fetch DND status + notification prefs for all target users
  const [statusResult, prefsResult] = await Promise.all([
    admin
      .from('hub_users')
      .select('id, status, status_until')
      .in('id', userIds),
    admin
      .from('notification_prefs')
      .select('user_id, room_id, level, dnd_enabled')
      .in('user_id', userIds),
  ])

  const statusMap: Record<string, { status: string | null; status_until: string | null }> = {}
  for (const u of statusResult.data ?? []) {
    statusMap[u.id] = { status: u.status, status_until: u.status_until }
  }

  type PrefRow = { user_id: string; room_id: string | null; level: string; dnd_enabled: boolean }
  const globalPrefs: Record<string, PrefRow> = {}
  const roomPrefs: Record<string, Record<string, PrefRow>> = {}
  for (const p of (prefsResult.data ?? []) as PrefRow[]) {
    if (!p.room_id) {
      globalPrefs[p.user_id] = p
    } else {
      if (!roomPrefs[p.user_id]) roomPrefs[p.user_id] = {}
      roomPrefs[p.user_id][p.room_id] = p
    }
  }

  const eligibleIds = userIds.filter(uid => {
    const s = statusMap[uid]
    const global = globalPrefs[uid]
    const roomPref = roomId ? roomPrefs[uid]?.[roomId] : undefined

    // Status-based DND (hub_users.status field)
    const isDndActive = s?.status === 'dnd' &&
      (!s.status_until || new Date(s.status_until) > new Date())
    if (isDndActive && !isMention) return false

    // Pref-based DND (notification_prefs.dnd_enabled on global row)
    if (global?.dnd_enabled && !isMention) return false

    // Global notification level
    if (global?.level === 'muted') return false
    if (global?.level === 'mentions' && !isMention && !isDm) return false

    // Per-room pref — muted room suppresses all pushes from that room (including mentions)
    if (roomPref?.level === 'muted') return false
    if (roomPref?.level === 'mentions' && !isMention) return false

    return true
  })

  if (eligibleIds.length === 0) return

  // Web Push (VAPID) — browser / PWA subscribers
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .in('user_id', eligibleIds)

  const json = JSON.stringify(payload)
  const webResults = await Promise.allSettled(
    (subs ?? []).map((sub: { endpoint: string; p256dh: string; auth_key: string }) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        json
      )
    )
  )
  for (const r of webResults) {
    if (r.status === 'rejected') {
      const e = r.reason as { statusCode?: number; message?: string }
      console.error('[hub-push] web-push failed:', e?.statusCode, e?.message)
    }
  }

  // APNs — native iOS app subscribers
  const { data: apnsRows } = await admin
    .from('apns_tokens')
    .select('device_token')
    .in('user_id', eligibleIds)

  const deviceTokens = (apnsRows ?? []).map((r: { device_token: string }) => r.device_token)
  if (deviceTokens.length > 0) {
    await sendApnsPush(deviceTokens, payload).catch((err: Error) =>
      console.error('[hub-push] apns failed:', err.message)
    )
  }

  // FCM — native Android app subscribers
  const { data: fcmRows } = await admin
    .from('fcm_tokens')
    .select('device_token')
    .in('user_id', eligibleIds)

  const fcmTokens = (fcmRows ?? []).map((r: { device_token: string }) => r.device_token)
  if (fcmTokens.length > 0) {
    await sendFcmPush(fcmTokens, payload).catch((err: Error) =>
      console.error('[hub-push] fcm failed:', err.message)
    )
  }
}
