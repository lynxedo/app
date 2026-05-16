import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('rooms')
    .select('id, name, description, is_private, archived_at, created_at')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rooms: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  // Check creation permission
  if (profile.role !== 'admin') {
    const { data: settings } = await supabase
      .from('hub_settings')
      .select('allow_member_room_creation')
      .eq('company_id', profile.company_id)
      .maybeSingle()
    if (settings && !settings.allow_member_room_creation) {
      return NextResponse.json({ error: 'Room creation restricted to admins' }, { status: 403 })
    }
  }

  const { name, description, is_private } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const { data: room, error } = await supabase
    .from('rooms')
    .insert({
      company_id: profile.company_id,
      name: name.trim(),
      description: description?.trim() ?? null,
      is_private: is_private ?? false,
    })
    .select('id, name, description, is_private')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Add creator as member
  await supabase.from('room_members').insert({ room_id: room.id, user_id: user.id, role: 'admin' })

  return NextResponse.json(room, { status: 201 })
}
