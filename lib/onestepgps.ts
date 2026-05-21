const ENDPOINT = 'https://track.onestepgps.com/v3/api/public/device'
const CACHE_TTL_MS = 20_000

export type FleetDriveStatus =
  | 'driving'
  | 'stopped'
  | 'off'
  | 'being_towed'
  | 'parked'
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

let cache: CacheEntry | null = null
let inflight: Promise<FleetDevice[]> | null = null

const ALLOWED_STATUS: FleetDriveStatus[] = [
  'driving',
  'stopped',
  'off',
  'being_towed',
  'parked',
]

function normalizeDevice(raw: unknown): FleetDevice | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const pt = (r.latest_device_point ?? r.latest_point ?? {}) as Record<string, unknown>
  const state = (r.device_state ?? r.state ?? {}) as Record<string, unknown>
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

async function fetchUpstream(): Promise<FleetDevice[]> {
  const key = process.env.ONESTEPGPS_API_KEY
  if (!key) throw new Error('ONESTEPGPS_API_KEY is not configured')
  const url = `${ENDPOINT}?api-key=${encodeURIComponent(key)}&latest_point=true`
  const res = await fetch(url, { cache: 'no-store' })
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

export async function getFleetDevices(): Promise<FleetDevice[]> {
  const now = Date.now()
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.devices
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const devices = await fetchUpstream()
      cache = { fetchedAt: Date.now(), devices }
      return devices
    } finally {
      inflight = null
    }
  })()
  return inflight
}
