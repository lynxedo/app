// Dispatch solver — pure, no I/O (Reference/PRDs/DISPATCH_ROUTING_PRD.md §6 Phase 2).
//
// A Dispatch lane is short (3-8 stops), so "Optimize day" tries EVERY stop
// order against a real drive-time matrix and keeps the best one that meets each
// promised time frame and the company's arrival hours — exact, not a heuristic.
// Past MAX_EXACT stops it falls back to a window-sorted start improved by 2-opt.
// Mapbox's Optimization API was ruled out: v1 has no time windows and caps at 12.
//
// "Find a slot" tries the new stop in every gap of every lane/day and ranks the
// gaps by the drive minutes it adds, never pushing an existing stop's time.
//
// All times are minutes since local midnight; matrices are in minutes.

export interface SolverStop {
  id: string
  durationMin: number
  /** Promised arrival window [start, end]; null = anytime. */
  window: [number, number] | null
}

export interface LaneProblem {
  stops: SolverStop[]
  /** (n+2)×(n+2): index 0 = start point, 1..n = stops in `stops` order, n+1 = end point. */
  matrix: number[][]
  arrivalFirst: number
  arrivalLast: number
  /** Nothing may be planned before this (e.g. "now" when optimizing today). */
  notBefore?: number
}

export interface Violation { id: string; kind: 'window' | 'hours'; lateMin: number }

export interface LaneSolution {
  order: string[]
  starts: Record<string, number>
  driveMin: number
  finishMin: number
  violations: Violation[]
}

export const MAX_EXACT = 8
const ROUND = 5

const roundUp = (m: number) => Math.ceil(m / ROUND) * ROUND

/** Plan one fixed order: each stop as early as allowed. */
export function scheduleOrder(p: LaneProblem, order: number[]): LaneSolution & { cost: number } {
  const n = p.stops.length
  const floor = Math.max(p.arrivalFirst, p.notBefore ?? 0)
  let prev = 0
  let t: number | null = null
  let drive = 0
  let windowLate = 0
  let hoursLate = 0
  const starts: Record<string, number> = {}
  const violations: Violation[] = []
  for (const k of order) {
    const s = p.stops[k]
    const travel = p.matrix[prev][k + 1] ?? 0
    drive += travel
    let arrival: number = t === null ? floor : Math.max(t + travel, floor)
    if (s.window) arrival = Math.max(arrival, s.window[0])
    arrival = roundUp(arrival)
    if (s.window && arrival > s.window[1]) {
      windowLate += arrival - s.window[1]
      violations.push({ id: s.id, kind: 'window', lateMin: arrival - s.window[1] })
    }
    if (arrival > p.arrivalLast) {
      hoursLate += arrival - p.arrivalLast
      violations.push({ id: s.id, kind: 'hours', lateMin: arrival - p.arrivalLast })
    }
    starts[s.id] = arrival
    t = arrival + s.durationMin
    prev = k + 1
  }
  drive += order.length ? (p.matrix[prev][n + 1] ?? 0) : 0
  const finish = (t ?? floor) + (order.length ? (p.matrix[prev][n + 1] ?? 0) : 0)
  return {
    order: order.map(k => p.stops[k].id),
    starts,
    driveMin: Math.round(drive),
    finishMin: finish,
    violations,
    // A broken promise outweighs any amount of driving; arrival hours next;
    // then drive; finishing earlier only breaks ties.
    cost: windowLate * 1000 + hoursLate * 100 + drive + finish * 0.001,
  }
}

function permute(n: number, visit: (order: number[]) => void) {
  const used = new Array<boolean>(n).fill(false)
  const cur: number[] = []
  const rec = () => {
    if (cur.length === n) { visit(cur.slice()); return }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue
      used[i] = true; cur.push(i)
      rec()
      cur.pop(); used[i] = false
    }
  }
  rec()
}

export function solveLane(p: LaneProblem): LaneSolution {
  const n = p.stops.length
  if (n === 0) return { order: [], starts: {}, driveMin: 0, finishMin: p.arrivalFirst, violations: [] }
  let best: (LaneSolution & { cost: number }) | null = null
  const consider = (order: number[]) => {
    const r = scheduleOrder(p, order)
    if (!best || r.cost < best.cost) best = r
  }
  if (n <= MAX_EXACT) {
    permute(n, consider)
  } else {
    // Start window-first, then 2-opt until nothing improves.
    let order = [...Array(n).keys()].sort((a, b) =>
      (p.stops[a].window?.[0] ?? 24 * 60) - (p.stops[b].window?.[0] ?? 24 * 60))
    let cur = scheduleOrder(p, order)
    let improved = true
    while (improved) {
      improved = false
      for (let i = 0; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          const cand = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)]
          const r = scheduleOrder(p, cand)
          if (r.cost < cur.cost - 1e-9) { order = cand; cur = r; improved = true }
        }
      }
    }
    best = cur
  }
  const b = best as unknown as LaneSolution & { cost: number }
  return { order: b.order, starts: b.starts, driveMin: b.driveMin, finishMin: b.finishMin, violations: b.violations }
}

// ── Find a slot ─────────────────────────────────────────────────────────────

export interface SlotLane {
  key: string                 // caller's id for this lane-day, e.g. "2026-10-21|<techId>"
  /** Existing timed stops, in time order. */
  existing: Array<{ id: string; start: number; end: number }>
  /** (n+3)×(n+3): 0 = start point, 1..n = existing, n+1 = end point, n+2 = the new stop. */
  matrix: number[][]
  hasStart: boolean
  notBefore?: number
}

export interface SlotOption {
  key: string
  startMin: number
  afterId: string | null
  beforeId: string | null
  addedMin: number
}

export function findSlotsInLane(
  lane: SlotLane,
  newStop: { durationMin: number; window: [number, number] | null },
  arrivalFirst: number,
  arrivalLast: number,
): SlotOption[] {
  const n = lane.existing.length
  const M = lane.matrix
  const NEW = n + 2
  const END = n + 1
  const floor = Math.max(arrivalFirst, lane.notBefore ?? 0)
  const out: SlotOption[] = []
  for (let i = 0; i <= n; i++) {
    const prevIdx = i === 0 ? 0 : i           // existing[i-1] sits at matrix index i
    const nextIdx = i === n ? END : i + 1
    const prevEnd = i === 0 ? null : lane.existing[i - 1].end
    let arrival: number = prevEnd === null ? floor : Math.max(prevEnd + (M[prevIdx][NEW] ?? 0), floor)
    if (newStop.window) arrival = Math.max(arrival, newStop.window[0])
    arrival = roundUp(arrival)
    if (arrival > arrivalLast) continue
    if (newStop.window && arrival > newStop.window[1]) continue
    const end = arrival + newStop.durationMin
    if (i < n && end + (M[NEW][nextIdx] ?? 0) > lane.existing[i].start) continue // would push the next stop
    // Without a start point the first leg costs nothing either way.
    const toNew = i === 0 && !lane.hasStart ? 0 : (M[prevIdx][NEW] ?? 0)
    const was = i === 0 && !lane.hasStart ? 0 : (M[prevIdx][nextIdx] ?? 0)
    out.push({
      key: lane.key,
      startMin: arrival,
      afterId: i === 0 ? null : lane.existing[i - 1].id,
      beforeId: i === n ? null : lane.existing[i].id,
      addedMin: Math.round(toNew + (M[NEW][nextIdx] ?? 0) - was),
    })
  }
  return out
}

/** Best gap per lane-day, then the cheapest `limit` overall (earlier day breaks ties). */
export function pickSlots(all: SlotOption[], limit = 3): SlotOption[] {
  const bestPerLane = new Map<string, SlotOption>()
  for (const o of all) {
    const cur = bestPerLane.get(o.key)
    if (!cur || o.addedMin < cur.addedMin || (o.addedMin === cur.addedMin && o.startMin < cur.startMin)) bestPerLane.set(o.key, o)
  }
  return [...bestPerLane.values()]
    .sort((a, b) => a.addedMin - b.addedMin || a.key.localeCompare(b.key) || a.startMin - b.startMin)
    .slice(0, limit)
}
