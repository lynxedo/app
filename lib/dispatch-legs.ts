// Dispatch — one road leg at a time (browser side, public Mapbox token).
//
// A Dispatch lane is short (shop → 3-6 stops → shop), and a drag changes only
// the legs next to the moved stop, so each A→B leg is fetched and cached on its
// own. The same leg feeds the lane's drive bar (minutes) and the map (path).
// Falls back to a straight line at 25 mph when Mapbox can't answer, and says so.

export interface LatLng { lat: number; lng: number }

export interface Leg {
  minutes: number
  miles: number
  coords: [number, number][] // [lng, lat]
  estimated: boolean         // true = straight-line fallback, not a real road path
}

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
const cache = new Map<string, Promise<Leg>>()
const MAX_CACHE = 400

const key = (a: LatLng, b: LatLng) => `${a.lng.toFixed(5)},${a.lat.toFixed(5)};${b.lng.toFixed(5)},${b.lat.toFixed(5)}`

function haversineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

function straight(a: LatLng, b: LatLng): Leg {
  const miles = haversineMiles(a, b) * 1.3 // roads aren't straight
  return { minutes: Math.round((miles / 25) * 60), miles: Math.round(miles * 10) / 10, coords: [[a.lng, a.lat], [b.lng, b.lat]], estimated: true }
}

async function fetchOne(a: LatLng, b: LatLng): Promise<Leg> {
  if (a.lat === b.lat && a.lng === b.lng) return { minutes: 0, miles: 0, coords: [[a.lng, a.lat]], estimated: false }
  if (!TOKEN) return straight(a, b)
  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${key(a, b)}?geometries=geojson&overview=full&access_token=${TOKEN}`
    const res = await fetch(url)
    if (!res.ok) return straight(a, b)
    const data = await res.json() as { code: string; routes?: Array<{ duration: number; distance: number; geometry: { coordinates: [number, number][] } }> }
    const r = data.routes?.[0]
    if (data.code !== 'Ok' || !r) return straight(a, b)
    return {
      minutes: Math.round(r.duration / 60),
      miles: Math.round((r.distance / 1609.34) * 10) / 10,
      coords: r.geometry.coordinates,
      estimated: false,
    }
  } catch {
    return straight(a, b)
  }
}

export function fetchLeg(a: LatLng, b: LatLng): Promise<Leg> {
  const k = key(a, b)
  const hit = cache.get(k)
  if (hit) return hit
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  const p = fetchOne(a, b)
  cache.set(k, p)
  // A fallback isn't worth keeping — try the real road again next time.
  p.then(l => { if (l.estimated) cache.delete(k) })
  return p
}
