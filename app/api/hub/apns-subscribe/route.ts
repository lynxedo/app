import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
