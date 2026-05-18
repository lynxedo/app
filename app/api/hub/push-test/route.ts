import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import webpush from 'web-push'

// Admin-only diagnostic endpoint: GET /api/hub/push-test
// Returns the push config state and optionally fires a test notification.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const pubKey = process.env.HUB_VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_HUB_VAPID_PUBLIC_KEY ?? null
  const privKey = process.env.HUB_VAPID_PRIVATE_KEY ?? null
  const email = process.env.HUB_VAPID_EMAIL ?? 'ben@heroeslawntx.com'

  const admin = createAdminClient()
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const result: Record<string, unknown> = {
    vapid_public_key_set: !!pubKey,
    vapid_private_key_set: !!privKey,
    vapid_email: email,
    subscription_count: (subs ?? []).length,
    subscriptions: (subs ?? []).map(s => ({
      endpoint_prefix: s.endpoint.slice(0, 60),
      created_at: s.created_at,
    })),
    push_attempted: false,
    push_results: [] as unknown[],
  }

  if (pubKey && privKey && (subs ?? []).length > 0) {
    webpush.setVapidDetails(`mailto:${email}`, pubKey, privKey)

    const payload = JSON.stringify({
      title: 'Hub push test',
      body: 'If you see this, push notifications are working.',
      url: '/hub',
    })

    result.push_attempted = true
    result.push_results = await Promise.all(
      (subs ?? []).map(async (sub: { endpoint: string; p256dh: string; auth_key: string }) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
            payload
          )
          return { endpoint: sub.endpoint.slice(0, 60), status: 'sent' }
        } catch (e: unknown) {
          const err = e as { statusCode?: number; message?: string; body?: string }
          return {
            endpoint: sub.endpoint.slice(0, 60),
            status: 'failed',
            code: err?.statusCode,
            message: err?.message,
            body: err?.body,
          }
        }
      })
    )
  }

  return NextResponse.json(result)
}
