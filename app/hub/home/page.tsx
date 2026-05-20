import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata = { title: 'Home' }

function greetingFor(now: Date) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      hour12: false,
    }).format(now)
  )
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function dateLabel(now: Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now)
}

type AnnouncementRow = {
  id: string
  content: string
  expires_at: string
  type?: string | null
  created_at: string
}

type RoomRow = {
  id: string
  name: string
  description: string | null
  is_private: boolean
  archived_at: string | null
}

export default async function HubHomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const now = new Date()
  const nowIso = now.toISOString()

  const [meResult, announcementsResult, memberRoomsResult] = await Promise.all([
    supabase.from('hub_users').select('display_name').eq('id', user.id).single(),
    supabase
      .from('hub_announcements')
      .select('id, content, expires_at, created_at')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(5),
    admin
      .from('room_members')
      .select('room_id, rooms!inner(id, name, description, is_private, archived_at)')
      .eq('user_id', user.id),
  ])

  const firstName =
    (meResult.data?.display_name ?? '').split(' ')[0] ||
    user.email?.split('@')[0] ||
    'there'

  const announcements = (announcementsResult.data ?? []) as AnnouncementRow[]

  const rooms = (memberRoomsResult.data ?? [])
    .map((m: { rooms: RoomRow | RoomRow[] }) => (Array.isArray(m.rooms) ? m.rooms[0] : m.rooms))
    .filter((r): r is RoomRow => !!r && !r.archived_at)
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 md:py-12">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-white">{greetingFor(now)}, {firstName}</h1>
          <p className="text-sm text-gray-400 mt-1">{dateLabel(now)}</p>
        </div>

        <section className="mb-10">
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Announcements</h2>
          {announcements.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 text-sm text-gray-500">
              No active announcements right now.
            </div>
          ) : (
            <div className="space-y-2">
              {announcements.map(a => (
                <div key={a.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <p className="text-white whitespace-pre-wrap">{a.content}</p>
                  <p className="text-xs text-gray-500 mt-3">
                    Expires {new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(new Date(a.expires_at))}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Jump back into</h2>
          {rooms.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 text-sm text-gray-500">
              You&apos;re not in any rooms yet. Ask an admin to add you, or browse from the sidebar.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {rooms.slice(0, 8).map(room => (
                <Link
                  key={room.id}
                  href={`/hub/${room.id}`}
                  className="bg-gray-900 border border-gray-800 hover:border-[#2E7EB8] rounded-xl p-4 transition-colors block"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white/40 text-sm">{room.is_private ? '🔒' : '#'}</span>
                    <span className="font-medium text-white">{room.name}</span>
                  </div>
                  {room.description && (
                    <p className="text-xs text-gray-500 line-clamp-2">{room.description}</p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
