// Server-side drive-time matrix for Dispatch's solver (Mapbox Matrix API).
//
// ⚠ The public Mapbox token is referrer-restricted to lynxedo.com, so every
// server-side call must send our origin as Referer (June 2026 lesson — without
// it Mapbox 403s and routing silently falls back to straight lines).
// One request takes at most 25 points; a Dispatch lane-day is far smaller.
// Falls back to a haversine estimate (25 mph, ×1.3 for roads) and says so.

export interface Pt { lat: number; lng: number }

const MAX_POINTS = 25
const cache = new Map<string, Promise<{ minutes: number[][]; estimated: boolean }>>()
const MAX_CACHE = 300

function haversineMiles(a: Pt, b: Pt): number {
  const R = 3958.8, r = Math.PI / 180
  const x = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

function estimate(pts: Pt[]): number[][] {
  return pts.map(a => pts.map(b => Math.round((haversineMiles(a, b) * 1.3 / 25) * 60)))
}

async function fetchMatrix(pts: Pt[]): Promise<{ minutes: number[][]; estimated: boolean }> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
  if (!token || pts.length < 2 || pts.length > MAX_POINTS) return { minutes: estimate(pts), estimated: true }
  const coords = pts.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
  try {
    const res = await fetch(
      `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}?annotations=duration&access_token=${token}`,
      { headers: process.env.NEXT_PUBLIC_APP_URL ? { Referer: process.env.NEXT_PUBLIC_APP_URL } : {} },
    )
    if (!res.ok) return { minutes: estimate(pts), estimated: true }
    const d = await res.json() as { code: string; durations?: Array<Array<number | null>> }
    if (d.code !== 'Ok' || !d.durations) return { minutes: estimate(pts), estimated: true }
    const est = estimate(pts)
    return {
      minutes: d.durations.map((row, i) => row.map((sec, j) => sec == null ? est[i][j] : Math.round(sec / 60))),
      estimated: false,
    }
  } catch {
    return { minutes: estimate(pts), estimated: true }
  }
}

/** Minutes between every pair of points (cached per exact point list). */
export function driveMatrix(pts: Pt[]): Promise<{ minutes: number[][]; estimated: boolean }> {
  const key = pts.map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';')
  const hit = cache.get(key)
  if (hit) return hit
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  const p = fetchMatrix(pts)
  cache.set(key, p)
  p.then(r => { if (r.estimated) cache.delete(key) })
  return p
}
