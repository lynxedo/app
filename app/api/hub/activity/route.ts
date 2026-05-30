import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { selectInChunks } from '@/lib/supabase/chunked-in'

const ACTIVITY_SELECT = `
  id, content, created_at, parent_id, room_id, conversation_id,
  sender:hub_users!sender_id (id, display_name, avatar_url, is_bot)
`

// Activity feed: returns messages where the user was @mentioned (by first name
// or @room) or where someone replied in a thread the user started. Last 30d,
// excluding the user's own messages and deleted ones. Sorted newest first.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const countOnly = url.searchParams.get('count_only') === '1'

  const admin = createAdminClient()

  // 1. Resolve my first name + my read-activity timestamp.
  const [meHubUserRes, profileRes] = await Promise.all([
    admin.from('hub_users').select('display_name').eq('id', user.id).single(),
    admin.from('user_profiles').select('last_activity_seen_at').eq('id', user.id).single(),
  ])
  const displayName: string = meHubUserRes.data?.display_name ?? ''
  const firstName = displayName.split(/\s+/)[0]?.toLowerCase() ?? ''
  const lastSeen = profileRes.data?.last_activity_seen_at ?? null

  if (!firstName) {
    return NextResponse.json({ activity: [], unreadCount: 0 })
  }

  // 2. Get my rooms + DM conversations.
  const [roomsRes, convsRes] = await Promise.all([
    admin.from('room_members').select('room_id').eq('user_id', user.id),
    admin.from('conversation_members').select('conversation_id').eq('user_id', user.id),
  ])
  const roomIds = (roomsRes.data ?? []).map(r => r.room_id)
  const convIds = (convsRes.data ?? []).map(c => c.conversation_id)

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // 3. Mentions: messages in my rooms/convs that mention me OR @room.
  // We use ILIKE + the first name. Postgres handles @ as a literal character.
  // We also fetch @room mentions (rooms only — DMs don't have @room).
  const orFilters: string[] = []
  if (roomIds.length > 0) {
    orFilters.push(`and(room_id.in.(${roomIds.join(',')}),content.ilike.%@${firstName}%)`)
    orFilters.push(`and(room_id.in.(${roomIds.join(',')}),content.ilike.%@room%)`)
  }
  if (convIds.length > 0) {
    orFilters.push(`and(conversation_id.in.(${convIds.join(',')}),content.ilike.%@${firstName}%)`)
  }

  const mentionsQuery = orFilters.length > 0
    ? admin
        .from('messages')
        .select(ACTIVITY_SELECT)
        .gte('created_at', since)
        .is('deleted_at', null)
        .neq('sender_id', user.id)
        .or(orFilters.join(','))
        .order('created_at', { ascending: false })
        .limit(200)
    : null

  // 4. Thread replies to my own top-level messages.
  // First: my top-level message ids in the last 30 days.
  const myParentsRes = await admin
    .from('messages')
    .select('id')
    .eq('sender_id', user.id)
    .is('parent_id', null)
    .is('deleted_at', null)
    .gte('created_at', since)
  const myParentIds = (myParentsRes.data ?? []).map(m => m.id)

  type ActivityRow = {
    id: string
    content: string | null
    created_at: string
    parent_id: string | null
    room_id: string | null
    conversation_id: string | null
    sender: { id: string; display_name: string; avatar_url: string | null; is_bot: boolean } | { id: string; display_name: string; avatar_url: string | null; is_bot: boolean }[] | null
  }

  // Chunk the parent_id IN-list: an active user can own hundreds of top-level
  // messages in 30 days, and one long IN-list overflows PostgREST's URL-length
  // limit (HTTP 400). Batch the lookups and merge, then re-sort + cap to 100.
  const [mentionsRes, repliesRows] = await Promise.all([
    mentionsQuery ? mentionsQuery : Promise.resolve({ data: [], error: null }),
    selectInChunks<ActivityRow>(myParentIds, (batch) =>
      admin
        .from('messages')
        .select(ACTIVITY_SELECT)
        .in('parent_id', batch)
        .gte('created_at', since)
        .is('deleted_at', null)
        .neq('sender_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100)
    ),
  ])

  const mentions = ((mentionsRes.data as ActivityRow[] | null) ?? []).map(m => ({ ...m, kind: 'mention' as const }))
  const replies = repliesRows
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 100)
    .map(m => ({ ...m, kind: 'reply' as const }))

  // 5. Merge + dedupe by id (a message could match both buckets if someone
  // replied to me with @firstname).
  const byId = new Map<string, typeof mentions[number] | typeof replies[number]>()
  for (const m of [...mentions, ...replies]) {
    if (!byId.has(m.id)) byId.set(m.id, m)
  }
  const activity = Array.from(byId.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  // Unread = items newer than last_activity_seen_at
  const unreadCount = lastSeen
    ? activity.filter(a => new Date(a.created_at) > new Date(lastSeen)).length
    : activity.length

  if (countOnly) {
    return NextResponse.json({ unreadCount })
  }

  return NextResponse.json({ activity, unreadCount, lastSeen })
}

// Mark the activity feed as seen — bumps last_activity_seen_at on the user's
// profile so the unread count zeros out.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('user_profiles')
    .update({ last_activity_seen_at: new Date().toISOString() })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
