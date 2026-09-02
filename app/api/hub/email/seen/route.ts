import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// POST /api/hub/email/seen
//
// Stamp this user's server-side "last opened the Inbox" timestamp so the unread
// rail dot clears on ALL of their devices, not just the one that opened it. Also
// broadcasts a `seen` event on the company inbox channel so any other device
// that's online right now clears instantly; the timestamp covers the offline
// catch-up case on the next poll or focus. Mirrors /api/txt/seen exactly.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const nowIso = new Date().toISOString()

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .maybeSingle()

  await supabase
    .from('user_profiles')
    .update({ inbox_last_seen_at: nowIso })
    .eq('id', user.id)

  if (profile?.company_id) {
    try {
      const channel = supabase.channel(`inbox:${profile.company_id}`)
      await channel.subscribe()
      await channel.send({
        type: 'broadcast',
        event: 'seen',
        payload: { user_id: user.id, seen_at: nowIso },
      })
      await supabase.removeChannel(channel)
    } catch (err) {
      console.warn('[inbox:seen] broadcast failed', err)
    }
  }

  return NextResponse.json({ ok: true, seen_at: nowIso })
}
