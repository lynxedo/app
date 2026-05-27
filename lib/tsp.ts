import type { LatLng } from './geocode'

/** Haversine distance in kilometers between two lat/lng points. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const dLat = (b.lat - a.lat) * (Math.PI / 180)
  const dLng = (b.lng - a.lng) * (Math.PI / 180)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const x =
    sinLat * sinLat +
    Math.cos(a.lat * (Math.PI / 180)) *
      Math.cos(b.lat * (Math.PI / 180)) *
      sinLng * sinLng
  return 2 * R * Math.asin(Math.sqrt(x))
}

/**
 * Optional anchors for the TSP boundary legs.
 * When `startAnchor` / `endAnchor` is set, the tour cost measures
 *   anchor → stops[order[0]] → … → stops[order[n-1]] → anchor
 * instead of depot → … → depot. Costs (`startCosts` / `endCosts`) are
 * matrix-based equivalents used when a duration matrix is provided.
 *
 * Used for locked-first / locked-last stops so the middle stops get
 * optimized around the real entry / exit points, not the depot.
 */
export interface TSPAnchorOpts {
  startAnchor?: LatLng
  endAnchor?: LatLng
  startCosts?: number[]  // length n: matrix cost from start to stops[i]
  endCosts?: number[]    // length n: matrix cost from stops[i] to end
}

/**
 * Tour cost — uses durationMatrix (seconds) when provided, haversine otherwise.
 * Index 0 in the matrix = depot; indices 1..n = stops in their original validStops order.
 */
function tourCost(
  pts: LatLng[],
  order: number[],
  depot: LatLng,
  matrix?: number[][],
  opts?: TSPAnchorOpts,
): number {
  if (order.length === 0) return 0

  const startAnchor = opts?.startAnchor ?? depot
  const endAnchor = opts?.endAnchor ?? depot
  const startCosts = opts?.startCosts
  const endCosts = opts?.endCosts

  if (matrix) {
    // Matrix indices: 0 = depot, 1..n = stops (order[i] + 1 because depot is index 0)
    let cost = startCosts ? startCosts[order[0]] : matrix[0][order[0] + 1]
    for (let i = 0; i < order.length - 1; i++) {
      cost += matrix[order[i] + 1][order[i + 1] + 1]
    }
    const last = order[order.length - 1]
    cost += endCosts ? endCosts[last] : matrix[last + 1][0]
    return cost
  }

  // Fallback: haversine
  let d = haversineKm(startAnchor, pts[order[0]])
  for (let i = 0; i < order.length - 1; i++) {
    d += haversineKm(pts[order[i]], pts[order[i + 1]])
  }
  d += haversineKm(pts[order[order.length - 1]], endAnchor)
  return d
}

/**
 * 2-opt TSP solver. Pure TS, no dependencies.
 * @param stops   Array of lat/lng coordinates for each stop.
 * @param depot   Starting/ending depot coordinates.
 * @param matrix  Optional NxN duration matrix in seconds (index 0 = depot).
 *                When provided, tour cost is measured in seconds of road travel
 *                rather than straight-line km. This finds a better real-world order.
 * @param opts    Optional start/end anchors to override the depot for the
 *                boundary legs (used when a stop is locked as first or last).
 * @returns Optimized index order into `stops`.
 */
export function twoOptTSP(
  stops: LatLng[],
  depot: LatLng,
  matrix?: number[][],
  opts?: TSPAnchorOpts,
): number[] {
  const n = stops.length
  if (n === 0) return []
  if (n <= 2) return stops.map((_, i) => i)

  let order = stops.map((_, i) => i)
  let best = tourCost(stops, order, depot, matrix, opts)
  let improved = true

  while (improved) {
    improved = false
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const candidate = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ]
        const d = tourCost(stops, candidate, depot, matrix, opts)
        if (d < best - 1e-10) {
          order = candidate
          best = d
          improved = true
        }
      }
    }
  }

  return order
}
