import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { endpoint, keys } = await request.json()
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription object' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  // Evict this endpoint from any other account first, so pushes for a
  // previously signed-in account can't land on this browser after an account
  // switch/logout (same one-device-one-account rule as apns-subscribe).
  await createAdminClient()
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .neq('user_id', user.id)

  await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        company_id: profile.company_id,
        endpoint,
        p256dh: keys.p256dh,
        auth_key: keys.auth,
      },
      { onConflict: 'user_id,endpoint' }
    )

  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { endpoint } = await request.json()

  await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', endpoint)

  return NextResponse.json({ success: true })
}
