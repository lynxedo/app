import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { pushBadgeUpdate } from '@/lib/hub-badges'

// GET — returns unread room IDs and conversation IDs for the current user
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  // Latest message per room + per conversation, aggregated server-side.
  // Used to scan every message in the company on every call (79k+ rows).
  const [unreadStateResult, receiptsResult] = await Promise.all([
    supabase.rpc('get_unread_state_for_user', {
      p_user_id: user.id,
      p_company_id: profile.company_id,
    }),
    supabase
      .from('hub_read_receipts')
      .select('room_id, conversation_id, last_read_at')
      .eq('user_id', user.id),
  ])

  const receiptRoomMap: Record<string, string> = {}
  const receiptConvMap: Record<string, string> = {}
  for (const r of receiptsResult.data ?? []) {
    if (r.room_id) receiptRoomMap[r.room_id] = r.last_read_at
    if (r.conversation_id) receiptConvMap[r.conversation_id] = r.last_read_at
  }

  const latestByRoom: Record<string, string> = {}
  const latestByConv: Record<string, string> = {}
  for (const row of (unreadStateResult.data ?? []) as { scope: string; scope_id: string; last_at: string }[]) {
    if (row.scope === 'room') latestByRoom[row.scope_id] = row.last_at
    else if (row.scope === 'conversation') latestByConv[row.scope_id] = row.last_at
  }

  const unread_room_ids = Object.entries(latestByRoom)
    .filter(([roomId, latestAt]) => {
      const readAt = receiptRoomMap[roomId]
      return !readAt || latestAt > readAt
    })
    .map(([id]) => id)

  const unread_conv_ids = Object.entries(latestByConv)
    .filter(([convId, latestAt]) => {
      const readAt = receiptConvMap[convId]
      return !readAt || latestAt > readAt
    })
    .map(([id]) => id)

  return NextResponse.json({ unread_room_ids, unread_conv_ids })
}

// POST — mark a room or conversation as read (upsert)
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const body = await request.json()
  const { room_id, conversation_id } = body
  if (!room_id && !conversation_id) return NextResponse.json({ error: 'room_id or conversation_id required' }, { status: 400 })

  const record: {
    company_id: string
    user_id: string
    room_id?: string
    conversation_id?: string
    last_read_at: string
  } = {
    company_id: profile.company_id,
    user_id: user.id,
    last_read_at: new Date().toISOString(),
  }
  if (room_id) record.room_id = room_id
  if (conversation_id) record.conversation_id = conversation_id

  const conflictCol = room_id ? 'user_id,room_id' : 'user_id,conversation_id'

  await supabase
    .from('hub_read_receipts')
    .upsert(record, { onConflict: conflictCol })

  // Push the new lower badge count to this user's other devices so reading
  // on phone clears the iPad badge too. Fire-and-forget — never block the
  // read-receipt response on push delivery.
  pushBadgeUpdate(createAdminClient(), user.id, profile.company_id)
    .catch((err: Error) => console.error('[read-receipts] badge update failed:', err.message))

  return NextResponse.json({ ok: true })
}
