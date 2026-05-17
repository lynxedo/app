import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: hubUser } = await supabase
    .from('hub_users')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .single()

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('phone')
    .eq('id', user.id)
    .single()

  return NextResponse.json({
    email: user.email,
    display_name: hubUser?.display_name ?? null,
    avatar_url: hubUser?.avatar_url ?? null,
    phone: profile?.phone ?? null,
  })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { display_name, phone } = await request.json()

  if (display_name !== undefined) {
    const { error } = await supabase
      .from('hub_users')
      .update({ display_name: display_name || null })
      .eq('id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (phone !== undefined) {
    const { error } = await supabase
      .from('user_profiles')
      .update({ phone: phone || null })
      .eq('id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
