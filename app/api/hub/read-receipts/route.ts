import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

  // Latest message per room (top-level only)
  const { data: latestRoomMsgs } = await supabase
    .from('messages')
    .select('room_id, created_at')
    .eq('company_id', profile.company_id)
    .not('room_id', 'is', null)
    .is('parent_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  // Latest message per conversation
  const { data: latestConvMsgs } = await supabase
    .from('messages')
    .select('conversation_id, created_at')
    .eq('company_id', profile.company_id)
    .not('conversation_id', 'is', null)
    .is('parent_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  // User's read receipts
  const { data: receipts } = await supabase
    .from('hub_read_receipts')
    .select('room_id, conversation_id, last_read_at')
    .eq('user_id', user.id)

  const receiptRoomMap: Record<string, string> = {}
  const receiptConvMap: Record<string, string> = {}
  for (const r of receipts ?? []) {
    if (r.room_id) receiptRoomMap[r.room_id] = r.last_read_at
    if (r.conversation_id) receiptConvMap[r.conversation_id] = r.last_read_at
  }

  // Find the latest message per room
  const latestByRoom: Record<string, string> = {}
  for (const m of latestRoomMsgs ?? []) {
    if (m.room_id && !latestByRoom[m.room_id]) {
      latestByRoom[m.room_id] = m.created_at
    }
  }

  // Find the latest message per conversation
  const latestByConv: Record<string, string> = {}
  for (const m of latestConvMsgs ?? []) {
    if (m.conversation_id && !latestByConv[m.conversation_id]) {
      latestByConv[m.conversation_id] = m.created_at
    }
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

  return NextResponse.json({ ok: true })
}
