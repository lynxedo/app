// The every-minute Fleet tick (POST /api/fleet/stops/tick): GPS backup for
// arrived / left, then the custom arrival alerts (a Hub DM from Amber).
// See lib/fleet-visits.ts for the rules, supabase/2026-10-08_fleet_stop_visits_and_alerts.sql
// for the tables.
import type { SupabaseClient } from '@supabase/supabase-js'
import { getFleetDevices, haversineMeters, type FleetDevice } from '@/lib/onestepgps'
import { loadAssignmentRows, resolveAssignments } from '@/lib/fleet-assignments'
import { customerServiceName, isAdjustmentItem } from '@/lib/after-service'
import { postGuardianToUserDm } from '@/lib/guardian-post'
import {
  ARRIVE_DWELL_MS,
  ARRIVE_RADIUS_M,
  LEAVE_DWELL_MS,
  LEAVE_RADIUS_M,
  type AlertKind,
  type ArrivedSource,
  type LeftSource,
} from '@/lib/fleet-visits'

type Admin = SupabaseClient

type TickStop = {
  id: string
  ord: number
  lat: number | null
  lng: number | null
  status: string | null
  arrived_at: string | null
  completed_at: string | null
  completed_by: string | null
  client_name: string | null
  address: string | null
  job_title: string | null
  line_items: unknown
}

type VisitRow = {
  stop_id: string
  company_id: string
  log_date: string
  tech_user_id: string | null
  device_id: string | null
  gps_near_since: string | null
  gps_arrived_at: string | null
  gps_away_since: string | null
  gps_left_at: string | null
  first_arrived_at: string | null
  first_arrived_source: ArrivedSource | null
  first_left_at: string | null
  first_left_source: LeftSource | null
}

type AlertRow = {
  id: string
  created_by: string
  kind: AlertKind
  tech_user_id: string | null
  stop_id: string | null
  alert_date: string | null
  enabled_at: string
}

export function chicagoToday(at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(at)
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
}

function isFinished(s: TickStop): boolean {
  return s.status === 'complete' || s.status === 'skipped'
}

function emptyVisit(stop: TickStop, companyId: string, date: string, techId: string, deviceId: string | null): VisitRow {
  return {
    stop_id: stop.id,
    company_id: companyId,
    log_date: date,
    tech_user_id: techId,
    device_id: deviceId,
    gps_near_since: null,
    gps_arrived_at: null,
    gps_away_since: null,
    gps_left_at: null,
    first_arrived_at: null,
    first_arrived_source: null,
    first_left_at: null,
    first_left_source: null,
  }
}

export type TickResult = {
  date: string
  stops: number
  trucks: number
  gps_error: string | null
  visits_written: number
  alerts_sent: number
}

export async function runFleetVisitTick(admin: Admin, companyId: string, now = new Date()): Promise<TickResult> {
  const date = chicagoToday(now)
  const nowMs = now.getTime()
  const nowIso = now.toISOString()

  // 1. Today's routes.
  const { data: entries, error } = await admin
    .from('daily_log_entries')
    .select(`
      id, tech_user_id,
      stops:daily_log_stops(
        id, ord, lat, lng, status, arrived_at, completed_at, completed_by,
        client_name, address, job_title, line_items, removed_from_jobber_at
      )
    `)
    .eq('company_id', companyId)
    .eq('log_date', date)
    .is('deleted_at', null)
  if (error) throw new Error(`entries: ${error.message}`)

  const routes = new Map<string, TickStop[]>()
  for (const e of (entries ?? []) as Array<{ tech_user_id: string | null; stops: Array<TickStop & { removed_from_jobber_at: string | null }> | null }>) {
    if (!e.tech_user_id) continue
    const list = routes.get(e.tech_user_id) ?? []
    for (const s of e.stops ?? []) if (!s.removed_from_jobber_at) list.push(s)
    routes.set(e.tech_user_id, list)
  }
  for (const list of routes.values()) list.sort((a, b) => a.ord - b.ord)
  const stopCount = [...routes.values()].reduce((n, l) => n + l.length, 0)
  const result: TickResult = { date, stops: stopCount, trucks: 0, gps_error: null, visits_written: 0, alerts_sent: 0 }
  if (stopCount === 0) return result

  // 2. What GPS has seen so far today.
  const { data: visitRows } = await admin
    .from('fleet_stop_visits')
    .select('*')
    .eq('company_id', companyId)
    .eq('log_date', date)
  const visits = new Map<string, VisitRow>()
  for (const v of (visitRows ?? []) as VisitRow[]) visits.set(v.stop_id, v)
  const before = new Map([...visits.entries()].map(([k, v]) => [k, JSON.stringify(v)]))

  // 3. Who drives what today, and where the trucks are.
  const { userToDevice } = resolveAssignments(await loadAssignmentRows(admin, companyId, date), date)
  let devices: FleetDevice[] = []
  try {
    devices = await getFleetDevices(companyId)
  } catch (err) {
    result.gps_error = err instanceof Error ? err.message : String(err)
  }
  const deviceById = new Map(devices.map((d) => [d.id, d]))

  const visitFor = (s: TickStop, techId: string) => {
    let v = visits.get(s.id)
    if (!v) {
      v = emptyVisit(s, companyId, date, techId, userToDevice.get(techId) ?? null)
      visits.set(s.id, v)
    }
    return v
  }

  // 4. GPS backup.
  for (const [techId, route] of routes) {
    const deviceId = userToDevice.get(techId)
    const truck = deviceId ? deviceById.get(deviceId) : undefined
    if (!truck) continue
    // A position more than 12 h old isn't where the truck is today.
    if (!Number.isFinite(Date.parse(truck.last_ping)) || nowMs - Date.parse(truck.last_ping) > 12 * 3600_000) continue
    result.trucks += 1

    const located = route.filter((s) => s.lat != null && s.lng != null)
    const dist = new Map(located.map((s) => [s.id, haversineMeters(truck.lat, truck.lng, s.lat as number, s.lng as number)]))

    // Where the truck is: the route's next stop within the arrive radius that
    // isn't finished and GPS hasn't seen it leave. On a street of neighbours this
    // is the lowest-numbered open one; once it's done, the next one takes over.
    const here = located.find((s) => {
      if (isFinished(s)) return false
      if (visits.get(s.id)?.gps_left_at) return false
      return (dist.get(s.id) ?? Infinity) <= ARRIVE_RADIUS_M
    })

    if (here) {
      const v = visitFor(here, techId)
      v.device_id = deviceId ?? v.device_id
      v.gps_away_since = null
      if (!v.gps_arrived_at) {
        v.gps_near_since = v.gps_near_since ?? nowIso
        if (nowMs - Date.parse(v.gps_near_since) >= ARRIVE_DWELL_MS) {
          v.gps_arrived_at = v.gps_near_since
          // Arriving at the next house means the last one is behind it.
          for (const other of located) {
            if (other.id === here.id) continue
            const ov = visits.get(other.id)
            if (ov?.gps_arrived_at && !ov.gps_left_at) {
              ov.gps_left_at = v.gps_near_since
              ov.gps_away_since = null
            }
          }
        }
      }
    }

    for (const s of located) {
      if (here && s.id === here.id) continue
      const v = visits.get(s.id)
      if (!v) continue
      // Drove past without stopping long enough.
      if (v.gps_near_since && !v.gps_arrived_at) v.gps_near_since = null
      if (v.gps_arrived_at && !v.gps_left_at) {
        if ((dist.get(s.id) ?? Infinity) > LEAVE_RADIUS_M) {
          v.gps_away_since = v.gps_away_since ?? nowIso
          if (nowMs - Date.parse(v.gps_away_since) >= LEAVE_DWELL_MS) {
            v.gps_left_at = v.gps_away_since
            v.gps_away_since = null
          }
        } else {
          v.gps_away_since = null
        }
      }
    }
  }

  // 5. The first moment each event was known, from any source. Never moves once set.
  for (const [techId, route] of routes) {
    for (const s of route) {
      if (s.status === 'skipped') continue
      const v = visits.get(s.id)
      const arrivedSignals: Array<[string, ArrivedSource]> = []
      if (s.arrived_at) arrivedSignals.push([s.arrived_at, 'tech'])
      if (v?.gps_arrived_at) arrivedSignals.push([v.gps_arrived_at, 'gps'])
      const leftSignals: Array<[string, LeftSource]> = []
      if (s.status === 'complete' && s.completed_at) leftSignals.push([s.completed_at, s.completed_by ? 'tech' : 'jobber'])
      if (v?.gps_left_at) leftSignals.push([v.gps_left_at, 'gps'])
      if (arrivedSignals.length === 0 && leftSignals.length === 0) continue

      const row = visitFor(s, techId)
      if (!row.first_arrived_at && arrivedSignals.length) {
        const [t, src] = arrivedSignals.reduce((a, b) => (Date.parse(a[0]) <= Date.parse(b[0]) ? a : b))
        row.first_arrived_at = t
        row.first_arrived_source = src
      }
      if (!row.first_left_at && leftSignals.length) {
        const [t, src] = leftSignals.reduce((a, b) => (Date.parse(a[0]) <= Date.parse(b[0]) ? a : b))
        row.first_left_at = t
        row.first_left_source = src
      }
    }
  }

  // 6. Save what changed.
  const changed = [...visits.values()].filter((v) => before.get(v.stop_id) !== JSON.stringify(v))
  if (changed.length > 0) {
    // Same keys on every row: a bulk upsert fills a key missing from one row with
    // NULL (not the column default), so a mix of loaded rows (which carry
    // created_at) and new rows (which don't) would null created_at. Send only
    // the columns this tick owns.
    const payload = changed.map((v) => ({
      stop_id: v.stop_id,
      company_id: v.company_id,
      log_date: v.log_date,
      tech_user_id: v.tech_user_id,
      device_id: v.device_id,
      gps_near_since: v.gps_near_since,
      gps_arrived_at: v.gps_arrived_at,
      gps_away_since: v.gps_away_since,
      gps_left_at: v.gps_left_at,
      first_arrived_at: v.first_arrived_at,
      first_arrived_source: v.first_arrived_source,
      first_left_at: v.first_left_at,
      first_left_source: v.first_left_source,
      updated_at: nowIso,
    }))
    const { error: upErr } = await admin
      .from('fleet_stop_visits')
      .upsert(payload, { onConflict: 'stop_id' })
    if (upErr) throw new Error(`visits upsert: ${upErr.message}`)
    result.visits_written = changed.length
  }

  // 7. Alerts.
  result.alerts_sent = await fireAlerts(admin, companyId, date, routes, visits)
  return result
}

type Event = { kind: AlertKind; techId: string; stop: TickStop; at: string; source: ArrivedSource | LeftSource }

/** Every alert-worthy event of the day, worked out from the current state. */
function dayEvents(routes: Map<string, TickStop[]>, visits: Map<string, VisitRow>): Event[] {
  const out: Event[] = []
  for (const [techId, route] of routes) {
    const v = (s: TickStop) => visits.get(s.id)
    for (const s of route) {
      const sv = v(s)
      if (sv?.first_arrived_at) {
        out.push({ kind: 'arrive_stop', techId, stop: s, at: sv.first_arrived_at, source: sv.first_arrived_source ?? 'gps' })
      }
      if (sv?.first_left_at) {
        out.push({ kind: 'leave_stop', techId, stop: s, at: sv.first_left_at, source: sv.first_left_source ?? 'gps' })
      }
    }

    // First stop of the day = the earliest arrival.
    const arrived = route.filter((s) => v(s)?.first_arrived_at)
    if (arrived.length > 0) {
      const first = arrived.reduce((a, b) => (Date.parse(v(a)!.first_arrived_at!) <= Date.parse(v(b)!.first_arrived_at!) ? a : b))
      out.push({ kind: 'arrive_first', techId, stop: first, at: v(first)!.first_arrived_at!, source: v(first)!.first_arrived_source ?? 'gps' })
    }

    // Last stop = decided when it happens (a mid-day re-route can reorder the day):
    // the stop arrived at most recently, with every OTHER stop already done,
    // skipped or visited, and the truck still there.
    if (arrived.length > 0) {
      const latest = arrived.reduce((a, b) => (Date.parse(v(a)!.first_arrived_at!) >= Date.parse(v(b)!.first_arrived_at!) ? a : b))
      const othersDone = route.every((s) => s.id === latest.id || isFinished(s) || !!v(s)?.first_arrived_at)
      if (othersDone && !v(latest)!.first_left_at) {
        out.push({ kind: 'arrive_last', techId, stop: latest, at: v(latest)!.first_arrived_at!, source: v(latest)!.first_arrived_source ?? 'gps' })
      }
    }

    // Left the last stop = the latest departure, with nothing else left to do.
    const left = route.filter((s) => v(s)?.first_left_at)
    if (left.length > 0) {
      const latestLeft = left.reduce((a, b) => (Date.parse(v(a)!.first_left_at!) >= Date.parse(v(b)!.first_left_at!) ? a : b))
      const allDone = route.every((s) => s.id === latestLeft.id || s.status === 'skipped' || !!v(s)?.first_left_at || s.status === 'complete')
      if (allDone) {
        out.push({ kind: 'leave_last', techId, stop: latestLeft, at: v(latestLeft)!.first_left_at!, source: v(latestLeft)!.first_left_source ?? 'gps' })
      }
    }
  }
  return out
}

function stopLine(stop: TickStop): string {
  const services: string[] = []
  if (Array.isArray(stop.line_items)) {
    for (const li of stop.line_items as Array<{ name?: unknown }>) {
      const name = typeof li?.name === 'string' ? li.name : ''
      if (!name || isAdjustmentItem(name)) continue
      const clean = customerServiceName(name)
      if (clean && !services.includes(clean)) services.push(clean)
    }
  }
  if (services.length === 0 && stop.job_title) services.push(customerServiceName(stop.job_title))
  const who = [stop.client_name, stop.address].filter(Boolean).join(', ')
  return `stop ${stop.ord}${who ? ` — ${who}` : ''}${services.length ? ` (${services.join(', ')})` : ''}`
}

function messageFor(e: Event, techName: string): string {
  const t = fmtTime(e.at)
  const via =
    e.source === 'gps'
      ? (e.kind === 'leave_stop' || e.kind === 'leave_last' ? ' · by GPS (not completed yet)' : ' · by GPS (Arrived not tapped)')
      : e.source === 'jobber'
        ? ' · completed in Jobber'
        : ''
  const line = stopLine(e.stop)
  switch (e.kind) {
    case 'arrive_stop': return `🚚 ${techName} arrived at ${line} at ${t}${via}.`
    case 'leave_stop': return `🚚 ${techName} left ${line} at ${t}${via}.`
    case 'arrive_first': return `🌅 ${techName} arrived at the first stop of the day — ${line} at ${t}${via}.`
    case 'arrive_last': return `🏁 ${techName} arrived at the last stop of the day — ${line} at ${t}${via}.`
    case 'leave_last': return `✅ ${techName} finished the last stop of the day — left ${line} at ${t}${via}.`
  }
}

async function fireAlerts(
  admin: Admin,
  companyId: string,
  date: string,
  routes: Map<string, TickStop[]>,
  visits: Map<string, VisitRow>,
): Promise<number> {
  // Company master switch (Admin → Fleet).
  const { data: settings } = await admin
    .from('fleet_settings')
    .select('alert_arrivals')
    .eq('company_id', companyId)
    .maybeSingle()
  if (settings && settings.alert_arrivals === false) return 0

  const { data: alertRows } = await admin
    .from('fleet_arrival_alerts')
    .select('id, created_by, kind, tech_user_id, stop_id, alert_date, enabled_at')
    .eq('company_id', companyId)
    .eq('enabled', true)
    .is('deleted_at', null)
    .or(`alert_date.is.null,alert_date.eq.${date}`)
  const alerts = (alertRows ?? []) as AlertRow[]
  if (alerts.length === 0) return 0

  const events = dayEvents(routes, visits)
  if (events.length === 0) return 0

  // Already fired today: per (alert, stop), and per (alert, tech) for the
  // once-a-day kinds (first / last).
  const todayStopIds = [...routes.values()].flat().map((s) => s.id)
  const techOfStop = new Map<string, string>()
  for (const [techId, route] of routes) for (const s of route) techOfStop.set(s.id, techId)
  const fired = new Set<string>()
  const firedTech = new Set<string>()
  for (let i = 0; i < todayStopIds.length; i += 100) {
    const { data } = await admin
      .from('fleet_arrival_alert_fires')
      .select('alert_id, stop_id')
      .in('alert_id', alerts.map((a) => a.id))
      .in('stop_id', todayStopIds.slice(i, i + 100))
    for (const f of data ?? []) {
      fired.add(`${f.alert_id}:${f.stop_id}`)
      firedTech.add(`${f.alert_id}:${techOfStop.get(f.stop_id as string)}`)
    }
  }

  const names = new Map<string, string>()
  const { data: people } = await admin
    .from('hub_users')
    .select('id, display_name')
    .eq('company_id', companyId)
    .in('id', [...routes.keys()])
  for (const p of people ?? []) names.set(p.id as string, (p.display_name as string) || 'Tech')

  let sent = 0
  for (const a of alerts) {
    for (const e of events) {
      if (e.kind !== a.kind) continue
      if (a.stop_id && a.stop_id !== e.stop.id) continue
      if (a.tech_user_id && a.tech_user_id !== e.techId) continue
      // Only what happened after the alert was set up / turned on.
      if (Date.parse(e.at) < Date.parse(a.enabled_at)) continue
      if (fired.has(`${a.id}:${e.stop.id}`)) continue
      const oncePerTech = a.kind === 'arrive_first' || a.kind === 'arrive_last' || a.kind === 'leave_last'
      if (oncePerTech && firedTech.has(`${a.id}:${e.techId}`)) continue

      // Claim it first — the primary key makes a second tick a no-op.
      const { error: claimErr } = await admin
        .from('fleet_arrival_alert_fires')
        .insert({ alert_id: a.id, stop_id: e.stop.id, company_id: companyId })
      fired.add(`${a.id}:${e.stop.id}`)
      firedTech.add(`${a.id}:${e.techId}`)
      if (claimErr) continue

      const messageId = await postGuardianToUserDm(companyId, a.created_by, messageFor(e, names.get(e.techId) ?? 'A tech'), { admin })
      if (messageId) {
        sent += 1
        await admin.from('fleet_arrival_alert_fires').update({ message_id: messageId }).eq('alert_id', a.id).eq('stop_id', e.stop.id)
      }
    }
  }
  return sent
}
