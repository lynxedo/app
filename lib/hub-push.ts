import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendApnsPush } from '@/lib/hub-apns'
import { sendFcmPush } from '@/lib/hub-fcm'
import { computeUnreadCount } from '@/lib/hub-badges'
import { isInDndSchedule, type DndSchedule } from '@/lib/twilio-voice'

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
  isMention?: boolean   // true when this push is an @mention (bypasses mentions-level filter, not DND)
  isDm?: boolean        // true for DM messages — bypasses mentions-level filter but not muted/DND
  roomId?: string | null  // room context for per-room mute checks
}

export async function sendHubPush(
  userIds: string[],
  payload: { title: string; body: string; url: string; type?: string; groupKey?: string },
  options: PushOptions = {}
) {
  const pubKey = process.env.HUB_VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_HUB_VAPID_PUBLIC_KEY
  if (!pubKey || userIds.length === 0) return

  ensureVapid()

  const admin = createAdminClient()
  const { isMention = false, isDm = false, roomId = null } = options

  // Fetch DND status + notification prefs + company_id + new unified DND columns for all target users
  const [statusResult, prefsResult, profilesResult] = await Promise.all([
    admin
      .from('hub_users')
      .select('id, status, status_until, company_id')
      .in('id', userIds),
    admin
      .from('notification_prefs')
      .select('user_id, room_id, level, notification_sound')
      .in('user_id', userIds),
    admin
      .from('user_profiles')
      .select('id, company_id, master_dnd_enabled, master_dnd_schedule, hub_dnd_enabled, hub_dnd_schedule')
      .in('id', userIds),
  ])

  const statusMap: Record<string, { status: string | null; status_until: string | null }> = {}
  const companyMap: Record<string, string> = {}
  for (const u of (statusResult.data ?? []) as { id: string; status: string | null; status_until: string | null; company_id: string }[]) {
    statusMap[u.id] = { status: u.status, status_until: u.status_until }
    if (u.company_id) companyMap[u.id] = u.company_id
  }
  type ProfileRow = { id: string; company_id: string; master_dnd_enabled: boolean; master_dnd_schedule: unknown; hub_dnd_enabled: boolean; hub_dnd_schedule: unknown }
  const profileMap: Record<string, ProfileRow> = {}
  for (const p of (profilesResult.data ?? []) as ProfileRow[]) {
    profileMap[p.id] = p
    if (p.company_id && !companyMap[p.id]) companyMap[p.id] = p.company_id
  }


  type PrefRow = { user_id: string; room_id: string | null; level: string; notification_sound?: string | null }
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
    const up = profileMap[uid]

    // Master DND — overrides everything, silences all notifications
    if (up?.master_dnd_enabled) return false
    if (isInDndSchedule((up?.master_dnd_schedule as DndSchedule | null) || null)) return false

    // Hub presence status DND (set when master DND is toggled on, or via status picker)
    const isDndActive = s?.status === 'dnd' &&
      (!s.status_until || new Date(s.status_until) > new Date())
    if (isDndActive) return false

    // Hub notifications DND — silences Hub message pushes only
    if (up?.hub_dnd_enabled) return false
    if (isInDndSchedule((up?.hub_dnd_schedule as DndSchedule | null) || null)) return false

    // Global notification level (all / mentions / muted)
    if (global?.level === 'muted') return false
    if (global?.level === 'mentions' && !isMention && !isDm) return false

    // Per-room pref — muted room suppresses all pushes from that room (including mentions)
    if (roomPref?.level === 'muted') return false
    if (roomPref?.level === 'mentions' && !isMention) return false

    return true
  })

  if (eligibleIds.length === 0) return

  // Per-user unread count for badge display. Computed in parallel across all
  // eligible users; each call is two cheap queries (RPC + receipts SELECT).
  const badgeMap: Record<string, number> = {}
  await Promise.all(eligibleIds.map(async (uid) => {
    const companyId = companyMap[uid]
    if (!companyId) return
    try {
      badgeMap[uid] = await computeUnreadCount(admin, uid, companyId)
    } catch (err) {
      console.error('[hub-push] badge count failed for', uid, (err as Error).message)
    }
  }))

  // Web Push (VAPID) — browser / PWA subscribers
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .in('user_id', eligibleIds)

  const subsList = (subs ?? []) as { endpoint: string; p256dh: string; auth_key: string }[]
  const json = JSON.stringify(payload)
  const webResults = await Promise.allSettled(
    subsList.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        json
      )
    )
  )
  const staleWebEndpoints: string[] = []
  webResults.forEach((r, i) => {
    if (r.status === 'rejected') {
      const e = r.reason as { statusCode?: number; message?: string }
      console.error('[hub-push] web-push failed:', e?.statusCode, e?.message)
      // 404 = subscription never existed; 410 Gone = browser unsubscribed.
      // Both are terminal — delete the row.
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        staleWebEndpoints.push(subsList[i].endpoint)
      }
    }
  })
  if (staleWebEndpoints.length > 0) {
    admin.from('push_subscriptions').delete().in('endpoint', staleWebEndpoints)
      .then(({ error }) => { if (error) console.error('[hub-push] delete stale web subs failed:', error.message) })
  }

  // APNs — native iOS app subscribers. Group by user_id so each device gets
  // a payload carrying its owner's actual unread count.
  const { data: apnsRows } = await admin
    .from('apns_tokens')
    .select('device_token, user_id')
    .in('user_id', eligibleIds)

  const apnsByUser: Record<string, string[]> = {}
  for (const r of (apnsRows ?? []) as { device_token: string; user_id: string }[]) {
    if (!apnsByUser[r.user_id]) apnsByUser[r.user_id] = []
    apnsByUser[r.user_id].push(r.device_token)
  }

  for (const [uid, tokens] of Object.entries(apnsByUser)) {
    const badge = badgeMap[uid]
    const sound = globalPrefs[uid]?.notification_sound ?? 'default'
    sendApnsPush(tokens, { ...payload, ...(typeof badge === 'number' ? { badge } : {}), sound })
      .then(({ staleTokens }) => {
        if (staleTokens.length > 0) {
          return admin.from('apns_tokens').delete().in('device_token', staleTokens)
        }
      })
      .catch((err: Error) => console.error('[hub-push] apns failed:', err.message))
  }

  // FCM — native Android app subscribers. Same per-user grouping.
  const { data: fcmRows } = await admin
    .from('fcm_tokens')
    .select('device_token, user_id')
    .in('user_id', eligibleIds)

  const fcmByUser: Record<string, string[]> = {}
  for (const r of (fcmRows ?? []) as { device_token: string; user_id: string }[]) {
    if (!fcmByUser[r.user_id]) fcmByUser[r.user_id] = []
    fcmByUser[r.user_id].push(r.device_token)
  }

  for (const [uid, tokens] of Object.entries(fcmByUser)) {
    const badge = badgeMap[uid]
    sendFcmPush(tokens, { ...payload, ...(typeof badge === 'number' ? { badge } : {}) })
      .then(({ staleTokens }) => {
        if (staleTokens.length > 0) {
          return admin.from('fcm_tokens').delete().in('device_token', staleTokens)
        }
      })
      .catch((err: Error) => console.error('[hub-push] fcm failed:', err.message))
  }
}
