// Server-side drive-time matrix for Dispatch's solver (Mapbox Matrix API).
//
// ⚠ The public Mapbox token is referrer-restricted to lynxedo.com, so every
// server-side call must send our origin as Referer (June 2026 lesson — without
// it Mapbox 403s and routing silently falls back to straight lines).
// One request takes at most 25 points. Bigger days (a 30-stop lawn route) are
// asked in blocks — up to 12 origins × 12 destinations per request, stitched
// into the full matrix (Oct 2026: "big days" for retiring the Advanced
// optimizer). Past MAX_REAL points, or if a block fails, the haversine estimate
// (25 mph, ×1.3 for roads) fills in and the result says so.

export interface Pt { lat: number; lng: number }

const MAX_POINTS = 25
const BLOCK = 12
const MAX_REAL = 72 // 6×6 = 36 block requests, inside Mapbox's ~60/min
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

/** One origins×destinations block (≤ 24 coordinates); null on any failure. */
async function fetchBlock(src: Pt[], dst: Pt[], token: string): Promise<Array<Array<number | null>> | null> {
  const coords = [...src, ...dst].map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
  const sources = src.map((_, i) => i).join(';')
  const destinations = dst.map((_, i) => src.length + i).join(';')
  try {
    const res = await fetch(
      `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}?annotations=duration&sources=${sources}&destinations=${destinations}&access_token=${token}`,
      { headers: process.env.NEXT_PUBLIC_APP_URL ? { Referer: process.env.NEXT_PUBLIC_APP_URL } : {} },
    )
    if (!res.ok) return null
    const d = await res.json() as { code: string; durations?: Array<Array<number | null>> }
    return d.code === 'Ok' && d.durations ? d.durations : null
  } catch {
    return null
  }
}

async function fetchBlocked(pts: Pt[], token: string): Promise<{ minutes: number[][]; estimated: boolean }> {
  const est = estimate(pts)
  const out = est.map(r => [...r])
  let estimated = false
  const chunks: number[][] = []
  for (let i = 0; i < pts.length; i += BLOCK) chunks.push([...Array(Math.min(BLOCK, pts.length - i)).keys()].map(k => i + k))
  const jobs: Array<() => Promise<void>> = []
  for (const si of chunks) for (const di of chunks) {
    jobs.push(async () => {
      const block = await fetchBlock(si.map(i => pts[i]), di.map(i => pts[i]), token)
      if (!block) { estimated = true; return }
      si.forEach((i, a) => di.forEach((j, b) => {
        const sec = block[a]?.[b]
        if (sec == null) estimated = true
        else out[i][j] = Math.round(sec / 60)
      }))
    })
  }
  for (let i = 0; i < jobs.length; i += 4) await Promise.all(jobs.slice(i, i + 4).map(j => j()))
  return { minutes: out, estimated }
}

async function fetchMatrix(pts: Pt[]): Promise<{ minutes: number[][]; estimated: boolean }> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
  if (!token || pts.length < 2 || pts.length > MAX_REAL) return { minutes: estimate(pts), estimated: true }
  if (pts.length > MAX_POINTS) return fetchBlocked(pts, token)
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
