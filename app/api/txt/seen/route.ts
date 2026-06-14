import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// POST /api/txt/seen
//
// #45 — stamp the user's server-side "last opened Txt2" timestamp so the unread
// rail dot clears on ALL of this user's devices, not just the one that opened
// the inbox. Also broadcasts a `seen` event on the company channel so any other
// device that's currently online clears the dot instantly (the timestamp covers
// the offline catch-up case on next poll/focus).
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const nowIso = new Date().toISOString()

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()

  await supabase
    .from('user_profiles')
    .update({ txt_last_seen_at: nowIso })
    .eq('id', user.id)

  if (profile?.company_id) {
    try {
      const channel = supabase.channel(`txt:${profile.company_id}`)
      await channel.subscribe()
      await channel.send({
        type: 'broadcast',
        event: 'seen',
        payload: { user_id: user.id, seen_at: nowIso },
      })
      await supabase.removeChannel(channel)
    } catch (err) {
      console.warn('[txt:seen] broadcast failed', err)
    }
  }

  return NextResponse.json({ ok: true, seen_at: nowIso })
}
