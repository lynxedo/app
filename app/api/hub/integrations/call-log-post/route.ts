import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GUARDIAN_HUB_USER_ID } from '@/lib/guardian-post'

export const dynamic = 'force-dynamic'

const HEROES_COMPANY_ID = '00000000-0000-0000-0000-000000000002'

export async function POST(request: Request) {
  const secret = request.headers.get('x-call-system-secret')
  if (!secret || secret !== process.env.CALL_SYSTEM_HUB_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { text?: unknown; parent_id?: unknown; recording_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 })

  const parentId =
    typeof body.parent_id === 'string' && body.parent_id ? body.parent_id : null
  const recordingId =
    typeof body.recording_id === 'string' && body.recording_id ? body.recording_id : null

  const admin = createAdminClient()

  const { data: room } = await admin
    .from('rooms')
    .select('id, company_id, archived_at')
    .eq('company_id', HEROES_COMPANY_ID)
    .ilike('name', 'call logs')
    .is('archived_at', null)
    .maybeSingle<{ id: string; company_id: string; archived_at: string | null }>()
  if (!room) {
    return NextResponse.json({ error: 'call_logs room not found' }, { status: 404 })
  }

  await admin
    .from('room_members')
    .upsert({ room_id: room.id, user_id: GUARDIAN_HUB_USER_ID, role: 'member' }, {
      onConflict: 'room_id,user_id',
      ignoreDuplicates: true,
    })

  const { data: msg, error: msgErr } = await admin
    .from('messages')
    .insert({
      company_id: room.company_id,
      room_id: room.id,
      sender_id: GUARDIAN_HUB_USER_ID,
      content: text,
      parent_id: parentId,
    })
    .select('id')
    .single<{ id: string }>()
  if (msgErr || !msg) {
    return NextResponse.json(
      { error: msgErr?.message ?? 'insert failed' },
      { status: 500 },
    )
  }

  if (recordingId && !parentId) {
    await admin
      .from('call_logs')
      .update({ hub_posted_at: new Date().toISOString() })
      .eq('company_id', room.company_id)
      .eq('recording_id', recordingId)
      .is('hub_posted_at', null)
  }

  return NextResponse.json({ ok: true, message_id: msg.id })
}
