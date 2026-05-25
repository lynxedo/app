import { NextResponse } from 'next/server'
import { postGuardianToRoom } from '@/lib/guardian-post'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const HEROES_COMPANY_ID = '00000000-0000-0000-0000-000000000002'

export async function POST(request: Request) {
  const secret = request.headers.get('x-watchdog-secret')
  if (!secret || secret !== process.env.WATCHDOG_HUB_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { text?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 })

  const admin = createAdminClient()

  const { data: room } = await admin
    .from('rooms')
    .select('id')
    .eq('company_id', HEROES_COMPANY_ID)
    .ilike('name', 'alerts')
    .is('archived_at', null)
    .maybeSingle<{ id: string }>()
  if (!room) {
    return NextResponse.json({ error: 'alerts room not found' }, { status: 404 })
  }

  const messageId = await postGuardianToRoom(room.id, text, { admin })
  if (!messageId) {
    return NextResponse.json({ error: 'post failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, message_id: messageId })
}
