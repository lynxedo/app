import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const [{ data: rooms }, { data: memberships }] = await Promise.all([
    admin
      .from('rooms')
      .select('id, name, description, is_private')
      .eq('is_private', false)
      .is('archived_at', null)
      .order('name'),
    admin
      .from('room_members')
      .select('room_id')
      .eq('user_id', user.id),
  ])

  const memberRoomIds = new Set((memberships ?? []).map(m => m.room_id))

  const roomsWithStatus = (rooms ?? []).map(r => ({
    ...r,
    is_member: memberRoomIds.has(r.id),
  }))

  return NextResponse.json({ rooms: roomsWithStatus })
}
