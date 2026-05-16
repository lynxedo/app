import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'

let vapidConfigured = false

function ensureVapid() {
  if (vapidConfigured) return
  if (!process.env.HUB_VAPID_PUBLIC_KEY || !process.env.HUB_VAPID_PRIVATE_KEY) return
  webpush.setVapidDetails(
    `mailto:${process.env.HUB_VAPID_EMAIL ?? 'ben@heroeslawntx.com'}`,
    process.env.HUB_VAPID_PUBLIC_KEY,
    process.env.HUB_VAPID_PRIVATE_KEY,
  )
  vapidConfigured = true
}

interface PushOptions {
  isMention?: boolean   // true when this push is an @mention (bypasses most DND)
  roomId?: string | null  // room context for per-room mute checks
}

export async function sendHubPush(
  userIds: string[],
  payload: { title: string; body: string; url: string },
  options: PushOptions = {}
) {
  if (!process.env.HUB_VAPID_PUBLIC_KEY || userIds.length === 0) return

  ensureVapid()

  const admin = createAdminClient()
  const { isMention = false, roomId = null } = options

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
    if (global?.level === 'mentions' && !isMention) return false

    // Per-room pref — muted room suppresses all pushes from that room (including mentions)
    if (roomPref?.level === 'muted') return false
    if (roomPref?.level === 'mentions' && !isMention) return false

    return true
  })

  if (eligibleIds.length === 0) return

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .in('user_id', eligibleIds)

  const json = JSON.stringify(payload)
  await Promise.allSettled(
    (subs ?? []).map((sub: { endpoint: string; p256dh: string; auth_key: string }) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        json
      )
    )
  )
}
