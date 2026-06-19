import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Acknowledgement gate for the Home screen. GET returns the active
// ANNOUNCEMENTS (not shout-outs) the current user hasn't acknowledged yet;
// POST records an acknowledgement. Acks are per-user-per-announcement, so a
// message only gates someone once — a new announcement re-triggers it.

type PendingAnnouncement = {
  id: string
  content: string
  expires_at: string
  created_at: string
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const nowIso = new Date().toISOString()

  // Active announcements (type='announcement' only — shout-outs never gate),
  // company scoping is enforced by RLS on hub_announcements (same source the
  // Home page + ticker read).
  const { data: active, error } = await supabase
    .from('hub_announcements')
    .select('id, content, expires_at, created_at')
    .eq('type', 'announcement')
    .is('archived_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const activeRows = (active ?? []) as PendingAnnouncement[]
  if (activeRows.length === 0) return NextResponse.json({ pending: [] })

  // Subtract what the user already acknowledged.
  const { data: acks } = await supabase
    .from('announcement_acknowledgements')
    .select('announcement_id')
    .eq('user_id', user.id)
    .in('announcement_id', activeRows.map(a => a.id))
  const ackedIds = new Set((acks ?? []).map(a => a.announcement_id as string))

  const pending = activeRows.filter(a => !ackedIds.has(a.id))
  return NextResponse.json({ pending })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { announcement_id?: string }
  try {
    body = (await request.json()) as { announcement_id?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.announcement_id) {
    return NextResponse.json({ error: 'announcement_id required' }, { status: 400 })
  }

  // Idempotent — re-acking is a no-op thanks to the unique (announcement_id, user_id).
  const { error } = await supabase
    .from('announcement_acknowledgements')
    .upsert(
      { announcement_id: body.announcement_id, user_id: user.id },
      { onConflict: 'announcement_id,user_id', ignoreDuplicates: true },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
