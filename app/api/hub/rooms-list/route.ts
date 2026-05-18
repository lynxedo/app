import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Return only rooms the user is a member of (Slack-style)
  const admin = createAdminClient()
  const { data: memberships, error } = await admin
    .from('room_members')
    .select('room_id, rooms!inner(id, name, is_private, archived_at)')
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type RoomShape = { id: string; name: string; is_private: boolean; archived_at: string | null }
  const rooms = (memberships ?? [])
    .map(m => {
      const r = m.rooms as RoomShape | RoomShape[]
      return Array.isArray(r) ? r[0] : r
    })
    .filter((r): r is RoomShape => !!r && !r.archived_at)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ archived_at: _a, ...r }) => r)

  return NextResponse.json({ rooms })
}
