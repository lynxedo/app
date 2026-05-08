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

function tourDist(pts: LatLng[], order: number[], depot: LatLng): number {
  if (order.length === 0) return 0
  let d = haversineKm(depot, pts[order[0]])
  for (let i = 0; i < order.length - 1; i++) {
    d += haversineKm(pts[order[i]], pts[order[i + 1]])
  }
  d += haversineKm(pts[order[order.length - 1]], depot)
  return d
}

/**
 * 2-opt TSP solver. Pure TS, no dependencies.
 * @param stops  Array of lat/lng coordinates for each stop.
 * @param depot  Starting/ending depot coordinates.
 * @returns Optimized index order into `stops`.
 */
export function twoOptTSP(stops: LatLng[], depot: LatLng): number[] {
  const n = stops.length
  if (n === 0) return []
  if (n <= 2) return stops.map((_, i) => i)

  let order = stops.map((_, i) => i)
  let best = tourDist(stops, order, depot)
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
        const d = tourDist(stops, candidate, depot)
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
