import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { token?: string }
  if (!body.token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  const admin = createAdminClient()

  // Get company_id for this user
  const { data: hu } = await admin
    .from('hub_users')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!hu?.company_id) return NextResponse.json({ error: 'No company found' }, { status: 400 })

  const { error } = await admin
    .from('fcm_tokens')
    .upsert(
      { user_id: user.id, company_id: hu.company_id, device_token: body.token, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,device_token' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { token?: string }
  if (!body.token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  const admin = createAdminClient()
  await admin
    .from('fcm_tokens')
    .delete()
    .eq('user_id', user.id)
    .eq('device_token', body.token)

  return NextResponse.json({ ok: true })
}
