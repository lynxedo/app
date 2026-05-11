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
 * Tour cost — uses durationMatrix (seconds) when provided, haversine otherwise.
 * Index 0 in the matrix = depot; indices 1..n = stops in their original validStops order.
 */
function tourCost(
  pts: LatLng[],
  order: number[],
  depot: LatLng,
  matrix?: number[][]
): number {
  if (order.length === 0) return 0

  if (matrix) {
    // Matrix indices: 0 = depot, 1..n = stops (order[i] + 1 because depot is index 0)
    let cost = matrix[0][order[0] + 1]
    for (let i = 0; i < order.length - 1; i++) {
      cost += matrix[order[i] + 1][order[i + 1] + 1]
    }
    cost += matrix[order[order.length - 1] + 1][0]
    return cost
  }

  // Fallback: haversine
  let d = haversineKm(depot, pts[order[0]])
  for (let i = 0; i < order.length - 1; i++) {
    d += haversineKm(pts[order[i]], pts[order[i + 1]])
  }
  d += haversineKm(pts[order[order.length - 1]], depot)
  return d
}

/**
 * 2-opt TSP solver. Pure TS, no dependencies.
 * @param stops   Array of lat/lng coordinates for each stop.
 * @param depot   Starting/ending depot coordinates.
 * @param matrix  Optional NxN duration matrix in seconds (index 0 = depot).
 *                When provided, tour cost is measured in seconds of road travel
 *                rather than straight-line km. This finds a better real-world order.
 * @returns Optimized index order into `stops`.
 */
export function twoOptTSP(
  stops: LatLng[],
  depot: LatLng,
  matrix?: number[][]
): number[] {
  const n = stops.length
  if (n === 0) return []
  if (n <= 2) return stops.map((_, i) => i)

  let order = stops.map((_, i) => i)
  let best = tourCost(stops, order, depot, matrix)
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
        const d = tourCost(stops, candidate, depot, matrix)
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
