import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: room } = await admin
    .from('rooms')
    .select('id, name, is_private, archived_at')
    .eq('id', id)
    .single()

  if (!room || room.archived_at) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  if (room.is_private) return NextResponse.json({ error: 'Cannot self-join a private room — ask an admin to add you' }, { status: 403 })

  const { error } = await admin
    .from('room_members')
    .upsert({ room_id: id, user_id: user.id, role: 'member' }, { onConflict: 'room_id,user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: room.id, name: room.name, is_private: room.is_private })
}
