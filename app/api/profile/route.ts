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
    .select('phone, hub_text_size, hub_pinned_ids, full_name, landing_page')
    .eq('id', user.id)
    .single()

  return NextResponse.json({
    email: user.email,
    full_name: profile?.full_name ?? null,
    display_name: hubUser?.display_name ?? null,
    avatar_url: hubUser?.avatar_url ?? null,
    phone: profile?.phone ?? null,
    hub_text_size: profile?.hub_text_size ?? 'default',
    hub_pinned_ids: profile?.hub_pinned_ids ?? [],
    landing_page: profile?.landing_page ?? 'hub',
  })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { display_name, full_name, phone, hub_text_size, hub_pinned_ids, landing_page } = await request.json()

  if (landing_page !== undefined && landing_page !== 'hub' && landing_page !== 'dashboard') {
    return NextResponse.json({ error: 'landing_page must be "hub" or "dashboard"' }, { status: 400 })
  }

  if (display_name !== undefined) {
    const { error } = await supabase
      .from('hub_users')
      .update({ display_name: display_name || null })
      .eq('id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const profileUpdates: Record<string, string | null | string[]> = {}
  if (full_name !== undefined) profileUpdates.full_name = full_name || null
  if (phone !== undefined) profileUpdates.phone = phone || null
  if (hub_text_size !== undefined) profileUpdates.hub_text_size = hub_text_size
  if (hub_pinned_ids !== undefined) profileUpdates.hub_pinned_ids = hub_pinned_ids
  if (landing_page !== undefined) profileUpdates.landing_page = landing_page

  if (Object.keys(profileUpdates).length > 0) {
    const { error } = await supabase
      .from('user_profiles')
      .update(profileUpdates)
      .eq('id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
