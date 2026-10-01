import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
      id, log_date, office_notes, route_sheet_url, route_sheet_name, created_at, created_by,
      route_loadout,
      secondary_tech_user_ids, completed_at, completed_by, closed_at, closed_by,
      tech:hub_users!tech_user_id(id, display_name, avatar_url),
      stops:daily_log_stops(
        id, ord, jobber_visit_id, client_name, client_phone, address, lat, lng,
        job_title, line_items, instructions, scheduled_start_at, scheduled_end_at,
        duration_minutes, status, arrived_at, completed_at, notes,
        on_my_way_sent_at, on_my_way_eta_minutes, weather, pesticide_record_id,
        skip_reason_id, skip_reason_label, pesticide_tech_notes,
        office_reviewed_at, office_reviewed_by,
        contact_id, jobber_client_id, jobber_job_id
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
    jobber_visit_id?: string | null
    [key: string]: unknown
  }

  // Work Orders Phase 1 — attach the irrigation inspection done on each stop so
  // the stop can say Start / Continue draft / View. Keyed on the Jobber visit id
  // (stable across a route re-send, which recreates stop rows), falling back to
  // stop_id. Read with the admin client, scoped to the company, and only for the
  // stops the RLS'd entries query above already returned.
  type InspLite = {
    id: string; status: string; jobber_visit_id: string | null; stop_id: string | null
    share_token: string | null; share_expires_at: string | null; finalized_at: string | null
  }
  const allStops = (entries ?? []).flatMap(e => (e.stops ?? []) as StopRow[])
  const visitIds = allStops.map(s => s.jobber_visit_id).filter((x): x is string => !!x)
  const stopIds = allStops.map(s => s.id)
  const inspByVisit = new Map<string, InspLite>()
  const inspByStop = new Map<string, InspLite>()
  if (allStops.length > 0) {
    const admin = createAdminClient()
    const orParts = [
      visitIds.length > 0 ? `jobber_visit_id.in.(${visitIds.map(v => `"${v}"`).join(',')})` : null,
      `stop_id.in.(${stopIds.join(',')})`,
    ].filter((x): x is string => !!x)
    const { data: insps } = await admin
      .from('irrigation_inspections')
      .select('id, status, jobber_visit_id, stop_id, share_token, share_expires_at, finalized_at')
      .eq('company_id', profile.company_id)
      .or(orParts.join(','))
      .order('finalized_at', { ascending: false, nullsFirst: true })
    for (const i of (insps ?? []) as InspLite[]) {
      // A draft outranks an older final (the tech is mid-inspection); among
      // finals the newest wins (ordering above).
      if (i.jobber_visit_id) {
        const cur = inspByVisit.get(i.jobber_visit_id)
        if (!cur || (i.status === 'draft' && cur.status !== 'draft')) inspByVisit.set(i.jobber_visit_id, i)
      }
      if (i.stop_id) {
        const cur = inspByStop.get(i.stop_id)
        if (!cur || (i.status === 'draft' && cur.status !== 'draft')) inspByStop.set(i.stop_id, i)
      }
    }
  }
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
  const inspectionFor = (s: StopRow) => {
    const i = (s.jobber_visit_id ? inspByVisit.get(s.jobber_visit_id) : undefined) ?? inspByStop.get(s.id)
    if (!i) return null
    const shareActive = !!i.share_token && (!i.share_expires_at || new Date(i.share_expires_at) > new Date())
    return {
      id: i.id,
      status: i.status === 'final' ? 'final' : 'draft',
      share_url: i.status === 'final' && shareActive ? `${baseUrl}/irrigation/${i.share_token}` : null,
    }
  }

  const sorted = (entries ?? []).map(e => ({
    ...e,
    stops: [...((e.stops ?? []) as StopRow[])]
      .sort((a, b) => a.ord - b.ord)
      .map(s => ({ ...s, inspection: inspectionFor(s) })),
    secondary_techs: ((e.secondary_tech_user_ids ?? []) as string[])
      .map(id => techMap.get(id))
      .filter((t): t is HubUserLite => Boolean(t)),
  }))

  return NextResponse.json({ entries: sorted, depot })
}
