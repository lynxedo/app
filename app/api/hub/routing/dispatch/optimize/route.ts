import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { driveMatrix, type Pt } from '@/lib/dispatch-matrix'
import { solveLane, scheduleOrder } from '@/lib/dispatch-solver'
import { hhmmToMinutes, normalizeDispatchSettings } from '@/lib/dispatch'

// Dispatch "Optimize day" — per lane, the best stop order + arrival times that
// keep every promised time frame and the arrival hours, against real drive
// times (lib/dispatch-solver.ts). Nothing is written to Jobber: the screen shows
// the result as a preview and only a click puts it in the draft. Each lane is
// optimized on its own — moving stops BETWEEN techs is Find a slot's job.
// Every run is logged in dispatch_runs.

interface LaneIn {
  techId: string
  start: Pt | null
  end: Pt | null
  stops: Array<{
    id: string
    lat: number
    lng: number
    durationMin: number
    window: [number, number] | null
    currentStart: number | null
  }>
}

const MAX_STOPS = 22 // 25-point Matrix limit, minus start, end and headroom

export async function POST(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const { companyId, userId } = auth
  const t0 = Date.now()

  const body = await request.json().catch(() => null) as { date?: string; lanes?: LaneIn[]; notBefore?: number | null } | null
  const lanes = (body?.lanes ?? []).filter(l => l && typeof l.techId === 'string' && Array.isArray(l.stops)).slice(0, 8)
  if (!body?.date || lanes.length === 0) return NextResponse.json({ error: 'Nothing to optimize' }, { status: 400 })

  const admin = createAdminClient()
  const { data: s } = await admin.from('company_routing_settings').select('dispatch_settings').eq('company_id', companyId).maybeSingle()
  const settings = normalizeDispatchSettings(s?.dispatch_settings)
  const arrivalFirst = hhmmToMinutes(settings.arrival_first)
  const arrivalLast = hhmmToMinutes(settings.arrival_last)

  const results = await Promise.all(lanes.map(async l => {
    const stops = l.stops.filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng)).slice(0, MAX_STOPS)
    if (stops.length === 0) return { techId: l.techId, skipped: 'No stops with an address to order.' }
    // Without a start/end point the first stop is reached from itself (0 min), etc.
    const startPt = l.start ?? stops[0]
    const endPt = l.end ?? stops[stops.length - 1]
    const { minutes, estimated } = await driveMatrix([startPt, ...stops, endPt])
    if (!l.start) minutes[0] = minutes[0].map(() => 0)
    if (!l.end) for (const row of minutes) row[row.length - 1] = 0

    const problem = {
      stops: stops.map(x => ({ id: x.id, durationMin: Math.max(5, Math.round(x.durationMin)), window: x.window })),
      matrix: minutes,
      arrivalFirst,
      arrivalLast,
      notBefore: typeof body.notBefore === 'number' ? body.notBefore : undefined,
    }
    const best = solveLane(problem)

    // "Before" = the order the lane has now (timed by current start, anytime last).
    const currentOrder = stops
      .map((x, i) => ({ i, t: x.currentStart ?? 24 * 60 + i }))
      .sort((a, b) => a.t - b.t)
      .map(x => x.i)
    const before = scheduleOrder(problem, currentOrder)

    return {
      techId: l.techId,
      order: best.order,
      starts: best.starts,
      driveMin: best.driveMin,
      beforeDriveMin: before.driveMin,
      beforeViolations: before.violations,
      violations: best.violations,
      estimated,
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
