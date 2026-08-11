/**
 * Mapbox Directions helper — road-following geometry for a route of any length.
 *
 * The Directions API caps a single request at 25 coordinates, which for a
 * depot→stops→depot loop means only 23 stops fit. Past that the old callers gave
 * up and drew straight lines, so a normal 28-stop day showed a spider web
 * instead of the actual drive. This splits the ordered points into consecutive
 * legs of <= 25 that SHARE a waypoint, fetches each, and stitches the geometry
 * back into one continuous LineString.
 */

export interface LatLng {
  lat: number
  lng: number
}

/** Mapbox Directions hard cap for the `driving` profile. */
const MAX_COORDS_PER_REQUEST = 25

/**
 * Safety ceiling on fan-out. 8 legs covers 8 x 24 + 1 = 193 points (~191
 * stops), far beyond any real route sheet, and keeps a runaway input from
 * firing dozens of Directions calls at once.
 */
const MAX_LEGS = 8

export interface DrivingPathResult {
  /** Road-following coordinates as [lng, lat] pairs, in travel order. */
  coordinates: [number, number][]
  /** True when at least one leg fell back to its straight-line waypoints. */
  partial: boolean
}

// In-process cache: per-leg coord-string + overview → road geometry. Keyed per
// leg rather than per whole route, so re-optimizing a day that shares a leg
// with the previous attempt reuses it.
//
// Bounded because one `overview=full` leg is ~6,000 coordinate pairs (a few
// hundred KB); an afternoon of re-optimizing would otherwise grow this without
// limit. Map keeps insertion order, so deleting the first key is FIFO eviction.
const legCache = new Map<string, [number, number][]>()
const MAX_CACHED_LEGS = 32

function cacheLeg(key: string, coords: [number, number][]): void {
  if (legCache.size >= MAX_CACHED_LEGS) {
    const oldest = legCache.keys().next().value
    if (oldest !== undefined) legCache.delete(oldest)
  }
  legCache.set(key, coords)
}

function coordsKey(pts: LatLng[]): string {
  return pts.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
}

/**
 * Split into consecutive legs of at most `max` points, where each leg begins on
 * the previous leg's LAST point. That shared waypoint is what makes the
 * stitched result continuous — without it the seams would be straight jumps.
 */
export function splitIntoLegs(pts: LatLng[], max = MAX_COORDS_PER_REQUEST): LatLng[][] {
  if (pts.length <= max) return [pts]
  const step = max - 1
  const legs: LatLng[][] = []
  for (let start = 0; start < pts.length - 1; start += step) {
    legs.push(pts.slice(start, Math.min(start + max, pts.length)))
  }
  return legs
}

async function fetchLeg(
  leg: LatLng[],
  token: string,
  overview: 'full' | 'simplified',
  signal?: AbortSignal,
): Promise<[number, number][] | null> {
  const key = `${overview}|${coordsKey(leg)}`
  const cached = legCache.get(key)
  if (cached) return cached

  const coordStr = leg.map(p => `${p.lng},${p.lat}`).join(';')
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}` +
    `?geometries=geojson&overview=${overview}&access_token=${token}`
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const data = await res.json() as {
      code: string
      routes?: Array<{ geometry: { coordinates: [number, number][] } }>
    }
    const coords = data.routes?.[0]?.geometry?.coordinates
    if (data.code !== 'Ok' || !coords?.length) return null
    cacheLeg(key, coords)
    return coords
  } catch {
    return null
  }
}

/**
 * Fetch the driving path through `pts` in order, chunking past the 25-coordinate
 * API cap. Returns null only when nothing could be fetched, so callers keep
 * their existing straight-line fallback for that case. A leg that fails on its
 * own contributes its straight-line waypoints and sets `partial`.
 */
export async function fetchDrivingPath(
  pts: LatLng[],
  token: string,
  opts: { overview?: 'full' | 'simplified'; signal?: AbortSignal } = {},
): Promise<DrivingPathResult | null> {
  if (!token || pts.length < 2) return null

  const legs = splitIntoLegs(pts)
  if (legs.length > MAX_LEGS) return null

  const overview = opts.overview ?? 'full'
  const results = await Promise.all(
    legs.map(leg => fetchLeg(leg, token, overview, opts.signal)),
  )
  if (results.every(r => r === null)) return null

  const coordinates: [number, number][] = []
  let partial = false
  results.forEach((r, i) => {
    if (!r) partial = true
    const legCoords: [number, number][] =
      r ?? legs[i].map(p => [p.lng, p.lat] as [number, number])
    // Legs share a waypoint, so every leg after the first repeats the previous
    // leg's final coordinate — drop it or the line doubles back on itself.
    coordinates.push(...(coordinates.length > 0 ? legCoords.slice(1) : legCoords))
  })

  return { coordinates, partial }
}

/** Wrap coordinates as a GeoJSON LineString feature for a map source. */
export function lineStringFeature(
  coordinates: [number, number][],
): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates },
  }
}
