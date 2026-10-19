import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { geocodeAddresses } from '@/lib/geocode'
import { driveMatrix, type Pt } from '@/lib/dispatch-matrix'
import { findSlotsInLane, pickSlots, solveLane, type SlotOption } from '@/lib/dispatch-solver'
import { addDays, hhmmToMinutes, isoToLocal, normalizeDispatchSettings, todayLocal } from '@/lib/dispatch'

// Dispatch "Find a slot" — the three cheapest places to put one stop across the
// next N days, by drive minutes added, never moving anyone else's time.
//
// Reads the Hub Jobber MIRROR (`visits`), not Jobber live: two weeks × several
// techs would be ~100 Jobber calls and the rate budget is shared with the sync
// and Amber. The mirror is at most ~10 minutes behind, and the pick goes into
// the draft, whose Send re-checks Jobber live anyway. ⚠ The mirror holds visits
// only — assessments and tasks on those days aren't seen here.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface Body {
  stop?: { id: string; address: string; durationMin: number; window: [number, number] | null }
  techIds?: string[]
  fromDate?: string
  days?: number
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay()
}

export async function POST(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const { companyId, userId } = auth
  const t0 = Date.now()

  const body = await request.json().catch(() => null) as Body | null
  const stop = body?.stop
  const techIds = (body?.techIds ?? []).filter(t => typeof t === 'string').slice(0, 8)
  if (!stop?.id || !stop.address) return NextResponse.json({ error: 'The stop needs an address' }, { status: 400 })
  if (techIds.length === 0) return NextResponse.json({ error: 'Pick at least one tech' }, { status: 400 })
  const days = Math.min(21, Math.max(1, Math.round(body?.days ?? 14)))
  const today = todayLocal()
  const fromDate = body?.fromDate && DATE_RE.test(body.fromDate) && body.fromDate > today ? body.fromDate : addDays(today, 1)

  const admin = createAdminClient()
  const [{ data: rs }, { data: techRows }] = await Promise.all([
    admin.from('company_routing_settings').select('depot_lat, depot_lng, default_service_minutes, dispatch_settings').eq('company_id', companyId).maybeSingle(),
    admin.from('dispatch_tech_settings').select('*').eq('company_id', companyId).in('jobber_user_id', techIds),
  ])
  const settings = normalizeDispatchSettings(rs?.dispatch_settings)
  const arrivalFirst = hhmmToMinutes(settings.arrival_first)
  const arrivalLast = hhmmToMinutes(settings.arrival_last)
  const defaultMin = (rs?.default_service_minutes as number | undefined) ?? 30
  const depot: Pt | null = rs?.depot_lat != null && rs?.depot_lng != null ? { lat: rs.depot_lat as number, lng: rs.depot_lng as number } : null

  const dates: string[] = []
  for (let i = 0; i < days; i++) {
    const d = addDays(fromDate, i)
    if (settings.work_days.includes(weekday(d))) dates.push(d)
  }
  if (dates.length === 0) return NextResponse.json({ options: [], note: 'No work days in that range (Admin → Routing → Dispatch).' })

  // Scheduled visits for those techs on those days, from the mirror.
  const { data: visits, error } = await admin.from('visits')
    .select('external_id, job_id, scheduled_date, start_at, end_at, tech_external_user_ids, completed_at')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .gte('scheduled_date', dates[0])
    .lte('scheduled_date', dates[dates.length - 1])
    .overlaps('tech_external_user_ids', techIds)
    .limit(2000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const jobIds = [...new Set((visits ?? []).map(v => v.job_id).filter(Boolean))] as string[]
  const jobs: Array<{ id: string; property_id: string | null }> = []
  for (let i = 0; i < jobIds.length; i += 150) {
    const { data } = await admin.from('jobs').select('id, property_id').in('id', jobIds.slice(i, i + 150))
    jobs.push(...((data ?? []) as Array<{ id: string; property_id: string | null }>))
  }
  const propIds = [...new Set(jobs.map(j => j.property_id).filter(Boolean))] as string[]
  const props: Array<{ id: string; address_line1: string | null; city: string | null; state: string | null; zip: string | null }> = []
  for (let i = 0; i < propIds.length; i += 150) {
    const { data } = await admin.from('properties').select('id, address_line1, city, state, zip').in('id', propIds.slice(i, i + 150))
    props.push(...((data ?? []) as typeof props))
  }
  const propOfJob = new Map(jobs.map(j => [j.id, j.property_id]))
  const addrOfProp = new Map(props.map(p => [p.id, p.address_line1 ? `${p.address_line1}, ${p.city ?? ''}, ${p.state ?? ''} ${p.zip ?? ''}`.trim() : null]))

  const addresses = new Set<string>([stop.address])
  const rows = (visits ?? []).flatMap(v => {
    if (v.external_id === stop.id || !v.start_at) return []
    const a = isoToLocal(v.start_at as string)
    // Midnight = Jobber's anytime placeholder: on that day, but with no clock time.
    const anytime = a.minutes === 0
    const b = v.end_at ? isoToLocal(v.end_at as string) : null
    const addr = addrOfProp.get(propOfJob.get(v.job_id as string) ?? '') ?? null
    if (!addr) return []
    addresses.add(addr)
    const timedEnd = b && b.date === a.date && b.minutes > a.minutes ? b.minutes : a.minutes + defaultMin
    return [{
      id: v.external_id as string, date: a.date, anytime,
      start: anytime ? null as number | null : a.minutes,
      duration: anytime ? defaultMin : timedEnd - a.minutes,
      techs: (v.tech_external_user_ids ?? []) as string[], addr,
    }]
  })

  const addrList = [...addresses]
  const coords = await geocodeAddresses(addrList)
  const coordOf = new Map(addrList.map((a, i) => [a, coords[i]]))
  const newPt = coordOf.get(stop.address)
  if (!newPt) return NextResponse.json({ error: "Couldn't find this stop's address on the map" }, { status: 422 })

  const startEnd = (techId: string): { start: Pt | null; end: Pt | null } => {
    const t = (techRows ?? []).find(r => r.jobber_user_id === techId)
    return {
      start: t?.start_kind === 'address' && t.start_lat != null ? { lat: t.start_lat, lng: t.start_lng } : depot,
      end: t?.end_kind === 'address' && t.end_lat != null ? { lat: t.end_lat, lng: t.end_lng } : depot,
    }
  }

  const all: SlotOption[] = []
  const laneInfo: Record<string, { date: string; techId: string; names: Record<string, string>; empty: boolean }> = {}
  const tasks: Array<() => Promise<void>> = []
  for (const date of dates) {
    for (const techId of techIds) {
      tasks.push(async () => {
        const dayRows = rows.filter(r => r.date === date && r.techs.includes(techId) && coordOf.get(r.addr))
        const { start, end } = startEnd(techId)
        const pts: Pt[] = [start ?? newPt, ...dayRows.map(r => coordOf.get(r.addr)!), end ?? newPt, newPt]
        const { minutes } = await driveMatrix(pts)
        if (!start) minutes[0] = minutes[0].map(() => 0)
        const n = dayRows.length

        // The day as it will actually run: timed stops keep their times, anytime
        // stops are planned around them by the same solver Optimize uses. Then
        // the new stop is tried in each gap of THAT plan.
        let order = [...Array(n).keys()].sort((x, y) => (dayRows[x].start ?? 0) - (dayRows[y].start ?? 0))
        const startOf: Record<string, number> = {}
        if (dayRows.some(r => r.anytime)) {
          const sub = minutes.slice(0, n + 2).map(row => row.slice(0, n + 2))
          const plan = solveLane({
            stops: dayRows.map(r => ({ id: r.id, durationMin: r.duration, window: r.start != null ? [r.start, r.start] as [number, number] : null })),
            matrix: sub, arrivalFirst, arrivalLast: 24 * 60 - 1,
          })
          order = plan.order.map(id => dayRows.findIndex(r => r.id === id))
          Object.assign(startOf, plan.starts)
        }
        for (const r of dayRows) if (r.start != null) startOf[r.id] = r.start
        const idx = [0, ...order.map(i => i + 1), n + 1, n + 2]
        const M2 = idx.map(r => idx.map(c => minutes[r][c]))
        const existing = order.map(i => dayRows[i]).map(r => ({ id: r.id, start: startOf[r.id], end: startOf[r.id] + r.duration }))

        const key = `${date}|${techId}`
        laneInfo[key] = { date, techId, names: Object.fromEntries(dayRows.map(r => [r.id, r.addr])), empty: n === 0 }
        all.push(...findSlotsInLane(
          { key, existing, matrix: M2, hasStart: !!start },
          { durationMin: Math.max(5, Math.round(stop.durationMin)), window: stop.window },
          arrivalFirst, arrivalLast,
        ))
      })
    }
  }
  // A few Matrix calls at a time — Mapbox allows ~60 a minute.
  for (let i = 0; i < tasks.length; i += 4) await Promise.all(tasks.slice(i, i + 4).map(t => t()))

  const picked = pickSlots(all, 3).map(o => ({
    ...o,
    date: laneInfo[o.key].date,
    techId: laneInfo[o.key].techId,
    afterAddress: o.afterId ? laneInfo[o.key].names[o.afterId] ?? null : null,
    beforeAddress: o.beforeId ? laneInfo[o.key].names[o.beforeId] ?? null : null,
    emptyDay: laneInfo[o.key].empty,
  }))

  const costMs = Date.now() - t0
  await admin.from('dispatch_runs').insert({
    company_id: companyId,
    kind: 'slots',
    run_date: fromDate,
    requested_by: userId,
    input: { stop, techIds, dates, arrivalFirst, arrivalLast },
    output: { options: picked, considered: all.length },
    cost_ms: costMs,
  })

  return NextResponse.json({ options: picked, considered: all.length, costMs })
}
