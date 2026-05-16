import { NextResponse } from 'next/server'
import bcrypt from 'bcrypt'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization') ?? ''
  const plainKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (plainKey.length < 8) return NextResponse.json({ error: 'Missing or invalid API key' }, { status: 401 })

  const keyPrefix = plainKey.slice(0, 8)
  const admin = createAdminClient()

  // Look up candidate keys by prefix — narrows to 1 row in practice
  const { data: candidates } = await admin
    .from('hub_api_keys')
    .select('id, company_id, name, key_hash, bot_user_id')
    .eq('key_prefix', keyPrefix)
    .is('revoked_at', null)

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  }

  // bcrypt compare — constant-time check
  type Candidate = { id: string; company_id: string; name: string; key_hash: string; bot_user_id: string | null }
  let matched: Candidate | null = null
  for (const c of candidates as Candidate[]) {
    if (await bcrypt.compare(plainKey, c.key_hash)) { matched = c; break }
  }
  if (!matched) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })

  let body: { room_name?: string; content?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const roomName = body.room_name?.trim()
  const content = body.content?.trim()
  if (!roomName) return NextResponse.json({ error: 'room_name required' }, { status: 400 })
  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 })

  // Look up room by name (case-insensitive) within company
  const { data: room } = await admin
    .from('rooms')
    .select('id')
    .eq('company_id', matched.company_id)
    .ilike('name', roomName)
    .is('archived_at', null)
    .maybeSingle()

  if (!room) return NextResponse.json({ error: `Room "${roomName}" not found` }, { status: 404 })

  // Use the pre-created bot user for this key
  const senderId = matched.bot_user_id
  if (!senderId) return NextResponse.json({ error: 'Key has no bot identity' }, { status: 500 })

  const { data: msg, error: msgErr } = await admin
    .from('messages')
    .insert({
      company_id: matched.company_id,
      room_id: room.id,
      sender_id: senderId,
      content,
    })
    .select('id, content, created_at')
    .single()

  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 })

  // Update last_used_at async (fire and forget)
  admin.from('hub_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', matched.id)
    .then(() => null)

  return NextResponse.json({ ok: true, message_id: msg.id })
}
