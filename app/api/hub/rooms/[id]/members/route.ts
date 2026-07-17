import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('user_profiles').select('role, company_id').eq('id', user.id).single()
  const isAdmin = profile?.role === 'admin'

  const admin = createAdminClient()

  if (!isAdmin) {
    // RLS on rooms enforces: same company AND (NOT is_private OR is_room_member).
    // If the user-session SELECT returns the row, they're allowed to see the members.
    // If it doesn't, return 404 so private-room existence doesn't leak.
    const { data: room } = await supabase.from('rooms').select('id').eq('id', id).maybeSingle()
    if (!room) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  } else {
    // Track 1 — the admin branch bypasses RLS; 404 unless the room is in the caller's company
    const { data: room } = await admin.from('rooms').select('company_id').eq('id', id).maybeSingle()
    if (!room || room.company_id !== profile?.company_id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  // Fetch member list via admin client — room_members RLS only returns own row.
  const { data, error } = await admin
    .from('room_members')
    .select('user_id, role, joined_at, hub_users!user_id (id, display_name, avatar_url)')
    .eq('room_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const members = (data ?? []).map((row: {
    user_id: string
    role: string
    joined_at: string
    hub_users: { id: string; display_name: string; avatar_url: string | null } | { id: string; display_name: string; avatar_url: string | null }[] | null
  }) => {
    const u = Array.isArray(row.hub_users) ? row.hub_users[0] : row.hub_users
    return { user_id: row.user_id, role: row.role, joined_at: row.joined_at, display_name: u?.display_name ?? '', avatar_url: u?.avatar_url ?? null }
  })

  return NextResponse.json({ members })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('user_profiles').select('role, company_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { user_id } = await request.json()
  if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  // Use admin client — room_members RLS only allows own rows
  const admin = createAdminClient()

  // Track 1 — the admin client bypasses RLS; 404 unless the room is in the caller's company
  const { data: room } = await admin.from('rooms').select('company_id').eq('id', id).maybeSingle()
  if (!room || room.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Track 1 — the user being added must belong to the caller's company too
  const { data: target } = await admin.from('user_profiles').select('company_id').eq('id', user_id).maybeSingle()
  if (!target || target.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const { error } = await admin
    .from('room_members')
    .upsert({ room_id: id, user_id, role: 'member' }, { onConflict: 'room_id,user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('user_profiles').select('role, company_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { user_id } = await request.json()
  if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  const admin = createAdminClient()

  // Track 1 — the admin client bypasses RLS; 404 unless the room is in the caller's company
  const { data: room } = await admin.from('rooms').select('company_id').eq('id', id).maybeSingle()
  if (!room || room.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error } = await admin
    .from('room_members')
    .delete()
    .eq('room_id', id)
    .eq('user_id', user_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
