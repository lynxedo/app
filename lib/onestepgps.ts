import { createAdminClient } from '@/lib/supabase/admin'

const ENDPOINT = 'https://track.onestepgps.com/v3/api/public/device'
const CACHE_TTL_MS = 20_000

// Resolve the OneStepGPS API key for a company. A per-company key entered in
// Admin → Integrations (stored on company_integrations, service-role only) wins;
// otherwise fall back to the shared env key so the original single-tenant Fleet
// setup (Heroes) is completely unchanged. Callers that pass no companyId (a few
// internal ops paths) keep using the env key.
export async function resolveOneStepGpsKey(companyId?: string): Promise<string | null> {
  if (companyId) {
    try {
      const { data } = await createAdminClient()
        .from('company_integrations')
        .select('config, enabled')
        .eq('company_id', companyId)
        .eq('provider', 'onestepgps')
        .maybeSingle()
      const cfg = (data?.config ?? null) as { api_key?: string } | null
      if (cfg?.api_key && data?.enabled !== false) return cfg.api_key
    } catch {
      // fall through to the env key
    }
  }
  return process.env.ONESTEPGPS_API_KEY ?? null
}

export type FleetDriveStatus =
  | 'driving'
  | 'idle'
  | 'off'
  | 'towing'
  | 'unknown'

export type FleetDevice = {
  id: string
  name: string
  lat: number
  lng: number
  speed_mph: number
  heading: number
  drive_status: FleetDriveStatus
  fuel_pct: number | null
  last_ping: string
}

type CacheEntry = { fetchedAt: number; devices: FleetDevice[] }

// Per-key caches — a company using its own OneStepGPS key never sees another
// tenant's cached devices. Heroes (env key) is a single entry, same as before.
const liveCache = new Map<string, CacheEntry>()
const liveInflight = new Map<string, Promise<FleetDevice[]>>()

// OneStepGPS's real drive_status enum, verified from live device history:
// driving / idle / off / towing. It never emits "stopped" or "parked", and it
// sends "towing" (not "being_towed"). The old whitelist was missing the very
// common "idle" (engine on, parked at a job) so idling trucks fell through to
// "unknown" → gray, making the fleet look gray most of the day.
const ALLOWED_STATUS: FleetDriveStatus[] = ['driving', 'idle', 'off', 'towing']

function normalizeDevice(raw: unknown): FleetDevice | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const pt = (r.latest_device_point ?? r.latest_point ?? {}) as Record<string, unknown>
  // OneStepGPS nests device_state under latest_device_point — not at top level.
  const state = (pt.device_state ?? r.device_state ?? r.state ?? {}) as Record<string, unknown>
  const lat = Number(pt.lat ?? pt.latitude)
  const lng = Number(pt.lng ?? pt.lon ?? pt.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const speedKmh = Number(pt.speed ?? 0)
  const fuelRaw = state.fuel_percent
  const statusRaw = String(state.drive_status ?? 'unknown')
  const status: FleetDriveStatus = (ALLOWED_STATUS as string[]).includes(statusRaw)
    ? (statusRaw as FleetDriveStatus)
    : 'unknown'
  return {
    id: String(r.device_id ?? r.id ?? ''),
    name: String(r.display_name ?? r.name ?? 'Unknown'),
    lat,
    lng,
    speed_mph: Math.round((speedKmh / 1.609344) * 10) / 10,
    heading: Number(pt.angle ?? pt.heading ?? 0),
    drive_status: status,
    fuel_pct:
      fuelRaw == null || fuelRaw === ''
        ? null
        : Math.round(Number(fuelRaw) * 10) / 10,
    last_ping: String(pt.dt_server ?? pt.dt_tracker ?? new Date().toISOString()),
  }
}

async function fetchUpstream(key: string): Promise<FleetDevice[]> {
  const url = `${ENDPOINT}?api-key=${encodeURIComponent(key)}&latest_point=true`
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`OneStepGPS upstream ${res.status}`)
  const body = (await res.json()) as unknown
  let list: unknown[] = []
  if (Array.isArray(body)) list = body
  else if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if (Array.isArray(b.result_list)) list = b.result_list as unknown[]
    else if (Array.isArray(b.data)) list = b.data as unknown[]
  }
  return list
    .map(normalizeDevice)
    .filter((d): d is FleetDevice => d !== null && d.id !== '')
}

export async function getFleetDevices(companyId?: string): Promise<FleetDevice[]> {
  const key = await resolveOneStepGpsKey(companyId)
  if (!key) throw new Error('ONESTEPGPS_API_KEY is not configured')
  const now = Date.now()
  const cached = liveCache.get(key)
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.devices
  const existing = liveInflight.get(key)
  if (existing) return existing
  const p = (async () => {
    try {
      const devices = await fetchUpstream(key)
      liveCache.set(key, { fetchedAt: Date.now(), devices })
      return devices
    } finally {
      liveInflight.delete(key)
    }
  })()
  liveInflight.set(key, p)
  return p
}

// ---------------------------------------------------------------------------
// Historical breadcrumb points (Day History)
//
// OneStepGPS exposes history at /device-point. Working params (verified live):
// dt_tracker_from / dt_tracker_to (ISO) + limit; results come back sorted
// sequence,desc (newest first) and the sort can't be changed. The similarly
// named dtf/dtt params are silently IGNORED (the API falls back to "last
// 24h") — don't "simplify" back to them. Each raw point is ~8 KB because it
// carries a full device_point_detail, so points are slimmed server-side
// before anything is cached or returned.
// ---------------------------------------------------------------------------

const HISTORY_ENDPOINT = 'https://track.onestepgps.com/v3/api/public/device-point'
const HISTORY_PAGE_LIMIT = 2000
const HISTORY_MAX_PAGES = 8
const HISTORY_CACHE_MAX_ENTRIES = 120
const HISTORY_TTL_PAST_MS = 6 * 60 * 60_000 // a finished day never changes
const HISTORY_TTL_LIVE_MS = 60_000 // today keeps growing

export type FleetHistoryPoint = {
  t: string // dt_tracker ISO timestamp
  lat: number
  lng: number
  speed_mph: number
  drive_status: FleetDriveStatus
}

export type FleetStop = {
  lat: number
  lng: number
  start: string
  end: string
  minutes: number
}

export type FleetHistory = { points: FleetHistoryPoint[]; stops: FleetStop[] }

const historyCache = new Map<string, { fetchedAt: number; ttlMs: number; data: FleetHistory }>()

function normalizeHistoryPoint(raw: unknown): FleetHistoryPoint | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const lat = Number(p.lat)
  const lng = Number(p.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const t = String(p.dt_tracker ?? p.dt_server ?? '')
  if (!t || !Number.isFinite(Date.parse(t))) return null
  const state = (p.device_state ?? {}) as Record<string, unknown>
  const statusRaw = String(state.drive_status ?? 'unknown')
  const speedKmh = Number(p.speed ?? 0)
  return {
    t,
    lat,
    lng,
    speed_mph: Math.round((speedKmh / 1.609344) * 10) / 10,
    drive_status: (ALLOWED_STATUS as string[]).includes(statusRaw)
      ? (statusRaw as FleetDriveStatus)
      : 'unknown',
  }
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

const STOP_RADIUS_M = 120
const STOP_MIN_MINUTES = 10

// Cluster consecutive pings that stay within STOP_RADIUS_M of the cluster's
// first point; any cluster spanning >= STOP_MIN_MINUTES is a stop. When the
// engine is off the device stops pinging, so the time gap between the last
// ping at a spot and the next ping (still at that spot when the engine
// restarts) correctly counts toward the stop's duration.
export function detectStops(points: FleetHistoryPoint[]): FleetStop[] {
  const stops: FleetStop[] = []
  let i = 0
  while (i < points.length) {
    const anchor = points[i]
    let j = i
    while (
      j + 1 < points.length &&
      haversineMeters(anchor.lat, anchor.lng, points[j + 1].lat, points[j + 1].lng) <= STOP_RADIUS_M
    ) {
      j++
    }
    const minutes = (Date.parse(points[j].t) - Date.parse(points[i].t)) / 60_000
    if (j > i && minutes >= STOP_MIN_MINUTES) {
      let sumLat = 0
      let sumLng = 0
      for (let k = i; k <= j; k++) {
        sumLat += points[k].lat
        sumLng += points[k].lng
      }
      const n = j - i + 1
      stops.push({
        lat: sumLat / n,
        lng: sumLng / n,
        start: points[i].t,
        end: points[j].t,
        minutes: Math.round(minutes),
      })
    }
    i = j > i ? j + 1 : i + 1
  }
  return stops
}

export async function getDeviceHistory(
  deviceId: string,
  fromIso: string,
  toIso: string,
  companyId?: string,
): Promise<FleetHistory> {
  const cacheKey = `${companyId ?? 'env'}|${deviceId}|${fromIso}|${toIso}`
  const cached = historyCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < cached.ttlMs) return cached.data

  const key = await resolveOneStepGpsKey(companyId)
  if (!key) throw new Error('ONESTEPGPS_API_KEY is not configured')

  const points: FleetHistoryPoint[] = []
  let pageTo = toIso
  for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
    const url =
      `${HISTORY_ENDPOINT}?api-key=${encodeURIComponent(key)}` +
      `&device_id=${encodeURIComponent(deviceId)}` +
      `&dt_tracker_from=${encodeURIComponent(fromIso)}` +
      `&dt_tracker_to=${encodeURIComponent(pageTo)}` +
      `&limit=${HISTORY_PAGE_LIMIT}`
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`OneStepGPS history upstream ${res.status}`)
    const body = (await res.json()) as { result_list?: unknown[] }
    const list = Array.isArray(body.result_list) ? body.result_list : []
    const batch = list
      .map(normalizeHistoryPoint)
      .filter((p): p is FleetHistoryPoint => p !== null)
    points.push(...batch)
    if (list.length < HISTORY_PAGE_LIMIT) break
    // Results are newest-first; continue the next page below the oldest
    // timestamp we've seen so far.
    const oldest = batch[batch.length - 1]?.t
    if (!oldest) break
    pageTo = new Date(Date.parse(oldest) - 1000).toISOString()
  }

  points.sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
  const data: FleetHistory = { points, stops: detectStops(points) }

  const ttlMs = Date.parse(toIso) < Date.now() - 60_000 ? HISTORY_TTL_PAST_MS : HISTORY_TTL_LIVE_MS
  historyCache.set(cacheKey, { fetchedAt: Date.now(), ttlMs, data })
  if (historyCache.size > HISTORY_CACHE_MAX_ENTRIES) {
    const oldestKey = historyCache.keys().next().value
    if (oldestKey) historyCache.delete(oldestKey)
  }
  return data
}
