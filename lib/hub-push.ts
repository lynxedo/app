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

export async function sendHubPush(
  userIds: string[],
  payload: { title: string; body: string; url: string }
) {
  if (!process.env.HUB_VAPID_PUBLIC_KEY) return

  ensureVapid()

  const admin = createAdminClient()
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .in('user_id', userIds)

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
