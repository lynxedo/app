import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import ShareIntoHub from '@/components/hub/ShareIntoHub'

export const metadata = { title: 'Share to Hub' }

// Where something shared INTO Lynxedo from another app lands.
//
// ⚠ The shared text is NOT in the URL. An address or a note is somebody's
// business, and a query string ends up in history, logs and referrers. The
// native shell puts it in sessionStorage on this origin and then navigates
// here; the client component reads it from there and clears it.
export default async function SharePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  // Rooms this person is actually in — the same membership rule the sidebar
  // uses, so the picker can never offer somewhere they cannot post.
  const { data: memberRooms } = await admin
    .from('room_members')
    .select('room_id, rooms!inner(id, name, is_private, archived_at)')
    .eq('user_id', user.id)

  type RoomShape = { id: string; name: string; is_private: boolean; archived_at: string | null }
  const rooms = (memberRooms ?? [])
    .map((m) => {
      const r = m.rooms as unknown as RoomShape | RoomShape[]
      return Array.isArray(r) ? r[0] : r
    })
    .filter((r): r is RoomShape => !!r && !r.archived_at)
    .map((r) => ({ id: r.id, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // DMs, named by the other people in them.
  const { data: myConvs } = await admin
    .from('conversation_participants')
    .select('conversation_id')
    .eq('user_id', user.id)
  const convIds = (myConvs ?? []).map((c) => c.conversation_id as string)

  let dms: { id: string; name: string }[] = []
  if (convIds.length > 0) {
    const { data: participants } = await admin
      .from('conversation_participants')
      .select('conversation_id, user_id, hub_users!inner(id, display_name)')
      .in('conversation_id', convIds)
      .neq('user_id', user.id)

    const byConv = new Map<string, string[]>()
    for (const row of participants ?? []) {
      const u = row.hub_users as unknown as { display_name: string } | { display_name: string }[]
      const name = (Array.isArray(u) ? u[0]?.display_name : u?.display_name) ?? 'Someone'
      const list = byConv.get(row.conversation_id as string) ?? []
      list.push(name)
      byConv.set(row.conversation_id as string, list)
    }
    dms = [...byConv.entries()]
      .map(([id, names]) => ({ id, name: names.sort().join(', ') }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  return <ShareIntoHub rooms={rooms} dms={dms} />
}
