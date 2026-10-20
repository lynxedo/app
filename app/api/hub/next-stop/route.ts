import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { myStopsToday } from '@/lib/my-route-today'

// The one stop this person is driving to next.
//
// Built for the home-screen widget, which has no webview to run the Daily Log
// screen's logic in. It answers a much narrower question than
// /api/hub/daily-log-v2 — that one returns the whole company's day, and a
// widget should not be sifting other crews' routes to find its own.
//
// ⚠ Today only, in Central, and only entries where this user is the tech or a
// secondary tech. A widget that showed somebody else's next stop would send a
// truck to the wrong house. Which stops still count is lib/my-route-today.ts —
// shared with the car screens so the widget and the dashboard never disagree.
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

  const { open, total, error } = await myStopsToday(createAdminClient(), user.id, profile.company_id)
  if (error) return NextResponse.json({ error }, { status: 500 })

  // In route order, the first one not already finished. in_progress counts as
  // next: it is the one they are standing at.
  const next = open[0] ?? null

  return NextResponse.json({
    // null with no error means "nothing left today" — the widget says so
    // rather than showing a blank card.
    stop: next && {
      client_name: next.client_name,
      address: next.address,
      scheduled_start_at: next.scheduled_start_at,
      in_progress: next.status === 'in_progress',
    },
    remaining: open.length,
    total,
  })
}
