import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { driveMatrix, type Pt } from '@/lib/dispatch-matrix'
import { solveLane, scheduleOrder } from '@/lib/dispatch-solver'
import { hhmmToMinutes, normalizeDispatchSettings } from '@/lib/dispatch'
import { computeDuration } from '@/lib/route-duration'
import { DEFAULT_DURATION_RULES, type DurationRulesConfig } from '@/app/api/settings/types'

// Dispatch "Optimize" — per lane, the best stop order + arrival times that keep
// every promised time frame and the arrival hours, against real drive times
// (lib/dispatch-solver.ts). Nothing is written to Jobber: the screen previews
// the result and only a click puts it in the draft / the Hub order. Each lane is
// optimized on its own — moving stops BETWEEN techs is Find a slot's job.
//
// Oct 2026 (toward retiring the Advanced optimizer):
//  • 📌 firstId / lastId pin a lane's first / last stop;
//  • visits at the same address are one stop to the solver and stay together
//    (0 drive between them), like the Advanced optimizer's grouping;
//  • durationMin may be omitted (Week/Month) — the server works it out from the
//    company's On-Site Duration rules, the same numbers the optimizer uses;
//  • up to 60 stops a lane (the matrix is fetched in blocks past 25 points).
// Every run is logged in dispatch_runs.

interface StopIn {
  id: string
  lat: number
  lng: number
  durationMin?: number | null
  window: [number, number] | null
  currentStart: number | null
  kind?: string
  title?: string
  lineItemNames?: string[]
}
interface LaneIn {
  techId: string
  start: Pt | null
  end: Pt | null
  stops: StopIn[]
  firstId?: string | null
  lastId?: string | null
}

const MAX_STOPS = 60
const addrKey = (s: { lat: number; lng: number }) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`

export async function POST(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const { companyId, userId } = auth
  const t0 = Date.now()

  const body = await request.json().catch(() => null) as { date?: string; lanes?: LaneIn[]; notBefore?: number | null } | null
  const lanes = (body?.lanes ?? []).filter(l => l && typeof l.techId === 'string' && Array.isArray(l.stops)).slice(0, 8)
  if (!body?.date || lanes.length === 0) return NextResponse.json({ error: 'Nothing to optimize' }, { status: 400 })

  const admin = createAdminClient()
  const { data: s } = await admin.from('company_routing_settings')
    .select('dispatch_settings, default_service_minutes, duration_method, duration_rules').eq('company_id', companyId).maybeSingle()
  const settings = normalizeDispatchSettings(s?.dispatch_settings)
  const arrivalFirst = hhmmToMinutes(settings.arrival_first)
  const arrivalLast = hhmmToMinutes(settings.arrival_last)
  const rules: DurationRulesConfig = { ...DEFAULT_DURATION_RULES, ...((s?.duration_rules as Partial<DurationRulesConfig>) ?? {}) }
  const method = (s?.duration_method as string | undefined) ?? 'default'
  const fallbackMin = (s?.default_service_minutes as number | undefined) ?? 30
  const minutesFor = (x: StopIn) => (typeof x.durationMin === 'number' && x.durationMin > 0
    ? x.durationMin
    : computeDuration(x.lineItemNames ?? [], x.title ?? '', x.kind ?? 'visit', method, rules, fallbackMin).minutes)

  const results = await Promise.all(lanes.map(async l => {
    const stops = l.stops.filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng)).slice(0, MAX_STOPS)
    if (stops.length === 0) return { techId: l.techId, skipped: 'No stops with an address to order.' }

    // Same address → one solver node; members keep their given order, a pinned one leads.
    const groups: StopIn[][] = []
    const byKey = new Map<string, StopIn[]>()
    for (const x of stops) {
      const k = addrKey(x)
      const g = byKey.get(k)
      if (g) g.push(x)
      else { const ng = [x]; byKey.set(k, ng); groups.push(ng) }
    }
    for (const g of groups) g.sort((a, b) => (a.id === l.firstId ? -1 : b.id === l.firstId ? 1 : 0) || (a.id === l.lastId ? 1 : b.id === l.lastId ? -1 : 0))
    const nodes = groups.map(g => {
      const wins = g.map(x => x.window).filter((w): w is [number, number] => !!w)
      let window: [number, number] | null = null
      if (wins.length) {
        const st = Math.max(...wins.map(w => w[0])), en = Math.min(...wins.map(w => w[1]))
        window = st <= en ? [st, en] : wins.sort((a, b) => a[1] - b[1])[0]
      }
      return { id: g[0].id, durationMin: g.reduce((sum, x) => sum + Math.max(5, Math.round(minutesFor(x))), 0), window, members: g }
    })

    const startPt = l.start ?? nodes[0].members[0]
    const endPt = l.end ?? nodes[nodes.length - 1].members[0]
    const { minutes, estimated } = await driveMatrix([startPt, ...nodes.map(nd => nd.members[0]), endPt])
    if (!l.start) minutes[0] = minutes[0].map(() => 0)
    if (!l.end) for (const row of minutes) row[row.length - 1] = 0

    const nodeOf = (id?: string | null) => (id ? nodes.findIndex(nd => nd.members.some(m => m.id === id)) : -1)
    const fi = nodeOf(l.firstId), li = nodeOf(l.lastId)
    const problem = {
      stops: nodes.map(nd => ({ id: nd.id, durationMin: nd.durationMin, window: nd.window })),
      matrix: minutes,
      arrivalFirst,
      arrivalLast,
      notBefore: typeof body.notBefore === 'number' ? body.notBefore : undefined,
      firstIdx: fi >= 0 ? fi : undefined,
      lastIdx: li >= 0 ? li : undefined,
    }
    const best = solveLane(problem)

    // Expand nodes back into their visits, back to back.
    const expand = (order: string[], startsIn: Record<string, number>) => {
      const ord: string[] = []
      const starts: Record<string, number> = {}
      for (const nid of order) {
        const nd = nodes.find(x => x.id === nid)!
        let t = startsIn[nid]
        for (const m of nd.members) {
          ord.push(m.id)
          starts[m.id] = t
          t += Math.max(5, Math.round(minutesFor(m)))
        }
      }
      return { ord, starts }
    }
    const out = expand(best.order, best.starts)

    // "Before" = the order the lane has now (timed by current start, anytime last).
    const currentOrder = nodes
      .map((nd, i) => ({ i, t: Math.min(...nd.members.map(m => m.currentStart ?? 24 * 60 + i)) }))
      .sort((a, b) => a.t - b.t)
      .map(x => x.i)
    const before = scheduleOrder(problem, currentOrder)
    const mapViolations = (vs: typeof best.violations) => vs.flatMap(v => {
      const nd = nodes.find(x => x.id === v.id)
      return nd ? nd.members.map(m => ({ ...v, id: m.id })) : [v]
    })

    return {
      techId: l.techId,
      order: out.ord,
      starts: out.starts,
      driveMin: best.driveMin,
      beforeDriveMin: before.driveMin,
      beforeViolations: mapViolations(before.violations),
      violations: mapViolations(best.violations),
      estimated,
      grouped: groups.filter(g => g.length > 1).length,
    }
  }))

  const costMs = Date.now() - t0
  await admin.from('dispatch_runs').insert({
    company_id: companyId,
    kind: 'optimize',
    run_date: body.date,
    requested_by: userId,
    input: { lanes, arrivalFirst, arrivalLast, notBefore: body.notBefore ?? null },
    output: { results },
    cost_ms: costMs,
  })

  return NextResponse.json({ results, arrivalFirst, arrivalLast, costMs })
}
