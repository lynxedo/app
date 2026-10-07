import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { customerServiceName, isAdjustmentItem } from '@/lib/after-service'
import { loadAssignmentRows, resolveAssignments, TECH_COLORS } from '@/lib/fleet-assignments'

export const dynamic = 'force-dynamic'

// Fleet stops PRD session 1: each tech's Work Order stops for a day, for the
// numbered pins on the Fleet map. Gated on can_access_fleet ONLY (Ben, Oct 5
// 2026: anyone with Fleet access sees the stops) — so it returns just what a
// pin needs: no phone numbers, notes, instructions or prices.
//
// "Done" = status 'complete', which the Work Orders sync also sets when the
// visit is completed in Jobber (Ben, Oct 6 2026) — lib/work-orders-sync.ts.

type StopRow = {
  id: string
  ord: number
  client_name: string | null
  address: string | null
  lat: number | null
  lng: number | null
  job_title: string | null
  line_items: unknown
  scheduled_start_at: string | null
  status: string | null
  completed_at: string | null
  removed_from_jobber_at: string | null
}

type EntryRow = {
  id: string
  tech_user_id: string | null
  stops: StopRow[] | null
}

export type FleetStopStatus = 'done' | 'skipped' | 'open'

export type FleetStop = {
  id: string
  n: number
  lat: number
  lng: number
  client_name: string
  services: string[]
  scheduled_start_at: string | null
  status: FleetStopStatus
  completed_at: string | null
  is_next: boolean
}

export type FleetStopsTech = {
  user_id: string
  name: string
  color: string
  device_id: string | null
  total: number
  stops: FleetStop[]
}

function serviceNames(lineItems: unknown, jobTitle: string | null): string[] {
  const out: string[] = []
  if (Array.isArray(lineItems)) {
    for (const li of lineItems) {
      const name = typeof li?.name === 'string' ? li.name : ''
      if (!name || isAdjustmentItem(name)) continue
      const clean = customerServiceName(name)
      if (clean && !out.includes(clean)) out.push(clean)
    }
  }
  if (out.length === 0 && jobTitle) out.push(customerServiceName(jobTitle))
  return out
}

function stopStatus(status: string | null): FleetStopStatus {
  if (status === 'complete') return 'done'
  if (status === 'skipped') return 'skipped'
  return 'open'
}

export type FleetDriver = {
  device_id: string
  user_id: string
  name: string
  color: string | null
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_fleet, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_fleet || !profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const companyId = profile.company_id

  const date = new URL(request.url).searchParams.get('date') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }

  // Service role: the Work Orders tables' own RLS is company-wide, but the
  // gate here is Fleet access, not Work Orders access — checked above.
  const admin = createAdminClient()
  const [{ data: entries, error }, assignmentRows] = await Promise.all([
    admin
      .from('daily_log_entries')
      .select(`
        id, tech_user_id,
        stops:daily_log_stops(
          id, ord, client_name, address, lat, lng, job_title, line_items,
          scheduled_start_at, status, completed_at, removed_from_jobber_at
        )
      `)
      .eq('company_id', companyId)
      .eq('log_date', date)
      .is('deleted_at', null),
    loadAssignmentRows(admin, companyId, date).catch(() => []),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { deviceToUser, userToDevice } = resolveAssignments(assignmentRows, date)

  // One tech can (rarely) have two entries on a day — merge them in ord order.
  const byTech = new Map<string, StopRow[]>()
  for (const e of (entries ?? []) as EntryRow[]) {
    if (!e.tech_user_id) continue
    const list = byTech.get(e.tech_user_id) ?? []
    list.push(...(e.stops ?? []))
    byTech.set(e.tech_user_id, list)
  }

  const techIds = [...byTech.keys()]
  const nameIds = [...new Set([...techIds, ...deviceToUser.values()])]
  const names = new Map<string, string>()
  if (nameIds.length > 0) {
    const { data: hubUsers } = await admin
      .from('hub_users')
      .select('id, display_name')
      .eq('company_id', companyId)
      .in('id', nameIds)
    for (const u of hubUsers ?? []) names.set(u.id as string, (u.display_name as string) || 'Tech')
  }

  const techs: FleetStopsTech[] = techIds
    .map((id) => ({ id, name: names.get(id) ?? 'Tech' }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ id, name }) => {
      // Numbered exactly like the tech's Work Order list (`ord` — the sync keeps
      // it 1..N in route order); a stop Jobber removed is not part of the route.
      const route = (byTech.get(id) ?? [])
        .filter((s) => !s.removed_from_jobber_at)
        .sort((a, b) => a.ord - b.ord)
      const nextIdx = route.findIndex((s) => stopStatus(s.status) === 'open')
      const stops: FleetStop[] = []
      route.forEach((s, idx) => {
        if (s.lat == null || s.lng == null) return
        stops.push({
          id: s.id,
          n: s.ord,
          lat: s.lat,
          lng: s.lng,
          client_name: s.client_name || s.address || 'Stop',
          services: serviceNames(s.line_items, s.job_title),
          scheduled_start_at: s.scheduled_start_at,
          status: stopStatus(s.status),
          completed_at: s.completed_at,
          is_next: idx === nextIdx,
        })
      })
      return {
        user_id: id,
        name,
        color: '',
        device_id: userToDevice.get(id) ?? null,
        total: route.length,
        stops,
      }
    })
    // An empty day (every visit moved off, or a shop day) isn't a route.
    .filter((t) => t.total > 0)
    .map((t, i) => ({ ...t, color: TECH_COLORS[i % TECH_COLORS.length] }))

  // Every linked truck's driver that day — labels the truck pin even when the
  // tech has no stops (a shop day, or a crew account not linked yet).
  const colorByTech = new Map(techs.map((t) => [t.user_id, t.color]))
  const drivers: FleetDriver[] = [...deviceToUser.entries()].map(([device_id, user_id]) => ({
    device_id,
    user_id,
    name: names.get(user_id) ?? 'Tech',
    color: colorByTech.get(user_id) ?? null,
  }))

  return NextResponse.json({ date, techs, drivers })
}
