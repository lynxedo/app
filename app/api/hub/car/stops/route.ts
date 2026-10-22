import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { workOrderAccess } from '@/lib/work-order-access'
import { myStopsToday } from '@/lib/my-route-today'
import { isAppReviewer, sampleCarStops } from '@/lib/app-review-demo'

// Today's route for the car screen (CarPlay / Android Auto).
//
// The phone app calls this natively with the webview's cookies — the car has no
// webview — so it answers only what a dashboard can show: who, where, and
// whether an On my way text already went. Same "still to do" rule as the Next
// stop widget (lib/my-route-today.ts).
//
// ⚠ Gated like every Work Orders API: the car's On my way button posts to
// /api/hub/daily-log/stops/[id]/on-my-way, which refuses anyone without Work
// Orders, so a list they could not act on would only confuse a driver.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // The store reviewers' account sees a made-up route (lib/app-review-demo.ts) —
  // never a real Heroes day, and it has no Work Orders grant.
  if (isAppReviewer(user.id)) return NextResponse.json(sampleCarStops())

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_admin_daily_log, can_access_daily_log_v2')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  if (!workOrderAccess(profile).canAccess) {
    return NextResponse.json({ error: 'Work Orders is not turned on for you', code: 'no_work_orders' }, { status: 403 })
  }

  const { open, total, error } = await myStopsToday(createAdminClient(), user.id, profile.company_id)
  if (error) return NextResponse.json({ error }, { status: 500 })

  return NextResponse.json({
    stops: open.map((s) => ({
      id: s.id,
      client_name: s.client_name,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      scheduled_start_at: s.scheduled_start_at,
      in_progress: s.status === 'in_progress',
      // The car hides On my way when there is no number to text — the endpoint
      // would answer 422. The number itself never leaves the server here.
      can_text: !!s.client_phone,
      on_my_way_sent_at: s.on_my_way_sent_at,
      on_my_way_eta_minutes: s.on_my_way_eta_minutes,
    })),
    remaining: open.length,
    total,
    // The ETA choices the car offers. Kept here so the office can change them
    // later without a store release.
    omw_etas: [10, 20, 30],
  })
}
