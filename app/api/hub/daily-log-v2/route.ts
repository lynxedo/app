import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type HubUserLite = { id: string; display_name: string; avatar_url: string | null }

// Read-only GET for Daily Log v2. Returns entries WITH attached stops.
// v1 endpoint stays untouched so the two pages can evolve independently
// during the parallel-rollout window.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 })

  const { data: routingSettings } = await supabase
    .from('company_routing_settings')
    .select('depot_lat, depot_lng')
    .eq('company_id', profile.company_id)
    .maybeSingle()

  const depot = (routingSettings?.depot_lat != null && routingSettings?.depot_lng != null)
    ? { lat: routingSettings.depot_lat as number, lng: routingSettings.depot_lng as number }
    : null

  const { data: entries, error } = await supabase
    .from('daily_log_entries')
    .select(`
      id, log_date, office_notes, route_sheet_url, route_sheet_name, created_at,
      secondary_tech_user_ids, completed_at, completed_by, closed_at, closed_by,
      tech:hub_users!tech_user_id(id, display_name, avatar_url),
      stops:daily_log_stops(
        id, ord, jobber_visit_id, client_name, client_phone, address, lat, lng,
        job_title, line_items, instructions, scheduled_start_at, scheduled_end_at,
        duration_minutes, status, arrived_at, completed_at, notes,
        on_my_way_sent_at, on_my_way_eta_minutes, weather, pesticide_record_id,
        skip_reason_id, skip_reason_label, pesticide_tech_notes
      )
    `)
    .eq('company_id', profile.company_id)
    .eq('log_date', date)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Resolve secondary tech info in one batch (mirrors v1 pattern)
  const secondaryIds = new Set<string>()
  for (const e of entries ?? []) {
    for (const id of (e.secondary_tech_user_ids ?? []) as string[]) secondaryIds.add(id)
  }
  const techMap = new Map<string, HubUserLite>()
  if (secondaryIds.size > 0) {
    const { data: techs } = await supabase
      .from('hub_users')
      .select('id, display_name, avatar_url')
      .in('id', [...secondaryIds])
    for (const t of (techs ?? []) as HubUserLite[]) techMap.set(t.id, t)
  }

  type StopRow = {
    id: string
    ord: number
    [key: string]: unknown
  }

  const sorted = (entries ?? []).map(e => ({
    ...e,
    stops: [...((e.stops ?? []) as StopRow[])].sort((a, b) => a.ord - b.ord),
    secondary_techs: ((e.secondary_tech_user_ids ?? []) as string[])
      .map(id => techMap.get(id))
      .filter((t): t is HubUserLite => Boolean(t)),
  }))

  return NextResponse.json({ entries: sorted, depot })
}
