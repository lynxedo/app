import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('notification_prefs')
    .select('user_id, room_id, level, dnd_enabled, dnd_start, dnd_end, notification_sound')
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ prefs: data ?? [] })
}

// POST body: { room_id?: string|null, level: 'all'|'mentions'|'muted', dnd_enabled?: boolean, dnd_start?: string|null, dnd_end?: string|null }
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { room_id = null, level, dnd_enabled, dnd_start, dnd_end } = body

  if (!['all', 'mentions', 'muted'].includes(level)) {
    return NextResponse.json({ error: 'Invalid level' }, { status: 400 })
  }

  // Delete-then-insert: cleanest pattern for partial unique indexes
  const deleteQ = supabase.from('notification_prefs').delete().eq('user_id', user.id)
  if (room_id) {
    await deleteQ.eq('room_id', room_id)
  } else {
    await deleteQ.is('room_id', null)
  }

  const { error } = await supabase.from('notification_prefs').insert({
    user_id: user.id,
    room_id,
    level,
    dnd_enabled: typeof dnd_enabled === 'boolean' ? dnd_enabled : false,
    dnd_start: dnd_start ?? null,
    dnd_end: dnd_end ?? null,
    updated_at: new Date().toISOString(),
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

const ALLOWED_SOUNDS = ['default', 'Glass', 'Ping', 'Tink', 'Pop']

// PATCH body: { notification_sound: string }
// Updates only the notification sound on the global prefs row (room_id IS NULL).
// Used by the iOS sound picker in Settings → Notifications.
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { notification_sound } = body
  if (!ALLOWED_SOUNDS.includes(notification_sound)) {
    return NextResponse.json({ error: 'Invalid sound' }, { status: 400 })
  }

  // Try UPDATE first; if no row exists create one with sensible defaults.
  const { data: existing } = await supabase
    .from('notification_prefs')
    .select('user_id')
    .eq('user_id', user.id)
    .is('room_id', null)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('notification_prefs')
      .update({ notification_sound, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('room_id', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabase
      .from('notification_prefs')
      .insert({ user_id: user.id, room_id: null, level: 'all', dnd_enabled: false, notification_sound })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
