import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { device_token } = await request.json()
  if (!device_token || typeof device_token !== 'string') {
    return NextResponse.json({ error: 'device_token required' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  // A physical device belongs to exactly one account — evict this token from
  // any other user before binding it here, so pushes for a previously
  // signed-in account can't land on this device after a logout/account switch.
  // Uses the admin client because RLS blocks deleting another user's row.
  await createAdminClient()
    .from('apns_tokens')
    .delete()
    .eq('device_token', device_token)
    .neq('user_id', user.id)

  await supabase
    .from('apns_tokens')
    .upsert(
      {
        user_id: user.id,
        company_id: profile.company_id,
        device_token,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,device_token' }
    )

  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { device_token } = await request.json()

  await supabase
    .from('apns_tokens')
    .delete()
    .eq('user_id', user.id)
    .eq('device_token', device_token)

  return NextResponse.json({ success: true })
}
