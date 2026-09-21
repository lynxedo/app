import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { centralDate } from '@/lib/timezone'

// The one stop this person is driving to next.
//
// Built for the home-screen widget, which has no webview to run the Daily Log
// screen's logic in. It answers a much narrower question than
// /api/hub/daily-log-v2 — that one returns the whole company's day, and a
// widget should not be sifting other crews' routes to find its own.
//
// ⚠ Today only, in Central, and only entries where this user is the tech or a
// secondary tech. A widget that showed somebody else's next stop would send a
// truck to the wrong house.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const today = centralDate(new Date())

  const { data: entries, error } = await admin
    .from('daily_log_entries')
    .select('id, log_date, tech_user_id, secondary_tech_user_ids, daily_log_stops(id, ord, client_name, address, scheduled_start_at, status)')
    .eq('log_date', today)
    .or(`tech_user_id.eq.${user.id},secondary_tech_user_ids.cs.{${user.id}}`)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Stop = {
    id: string; ord: number; client_name: string | null; address: string | null
    scheduled_start_at: string | null; status: string | null
  }

  const stops: Stop[] = (entries ?? []).flatMap(
    (e) => (e.daily_log_stops as unknown as Stop[] | null) ?? [],
  )

  // In route order, the first one not already finished. in_progress counts as
  // next: it is the one they are standing at.
  const next = stops
    .filter((s) => s.status !== 'complete')
    .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0))[0] ?? null

  const remaining = stops.filter((s) => s.status !== 'complete').length

  return NextResponse.json({
    // null with no error means "nothing left today" — the widget says so
    // rather than showing a blank card.
    stop: next && {
      client_name: next.client_name,
      address: next.address,
      scheduled_start_at: next.scheduled_start_at,
      in_progress: next.status === 'in_progress',
    },
    remaining,
    total: stops.length,
  })
}
