import { createAdminClient } from '@/lib/supabase/admin'
import { cleanZoneNumber, matchZoneOption, WEEKDAYS, type DictatedZone, type IrrigationData } from '@/lib/irrigation'

// Rachio (smart irrigation controllers) — "Import from Rachio" on the
// irrigation inspection (Ben, Oct 7 2026: "the zones, the descriptions, whether
// they're spray heads or rotors, full sun … and schedule information, if
// possible … pre-load it into the form").
//
// Rachio's public API (v1, https://api.rach.io/1/public, Bearer API key from the
// Rachio app → Account → API access) is per ACCOUNT: one key sees the
// controllers on that account (and, when Rachio lists them there, controllers
// shared with it). The company's key is pasted in Admin → Integrations and kept
// on company_integrations (service-role only) like OneStepGPS / VoiceDrop.
// Everything here is READ-ONLY — we never change a customer's controller.
//
// What's imported fills only blanks and is marked for the tech to review —
// the same rule as dictation and photo fill.

type Admin = ReturnType<typeof createAdminClient>
const API = 'https://api.rach.io/1/public'

export async function resolveRachioKey(admin: Admin, companyId: string): Promise<string | null> {
  const { data } = await admin.from('company_integrations')
    .select('config, enabled').eq('company_id', companyId).eq('provider', 'rachio').maybeSingle()
  const key = ((data?.config ?? null) as { api_key?: string } | null)?.api_key
  return data?.enabled !== false && key ? key : null
}

async function rachioGet<T>(key: string, path: string, timeoutMs = 10_000): Promise<{ ok: true; data: T } | { ok: false; status: number | null; reachable: boolean }> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false, status: res.status, reachable: true }
    return { ok: true, data: (await res.json()) as T }
  } catch {
    return { ok: false, status: null, reachable: false }
  }
}

async function rachioPut(key: string, path: string, body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; status: number | null; message: string }> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    })
    if (res.ok) return { ok: true }
    const j = await res.json().catch(() => ({})) as { error?: string }
    return { ok: false, status: res.status, message: j.error || `Rachio returned ${res.status}` }
  } catch {
    return { ok: false, status: null, message: 'Could not reach Rachio' }
  }
}

// ── Test run (Ben, Oct 8 2026) ───────────────────────────────────────────────
// "a quick run of each zone running in sequence for 2 mins each … a button to
// skip to the next zone … a stop button". The phone drives the sequence; every
// start carries its own duration, so the CONTROLLER turns each zone off on its
// own even if the phone loses signal or the tech walks away. These are the only
// two things Hub ever changes on a customer's controller.

export const TEST_RUN_SECONDS = 120
export const TEST_RUN_MAX_SECONDS = 300

/** Run one zone for `seconds` (stopping whatever was running first). */
export async function startRachioZone(key: string, deviceId: string, zoneId: string, seconds: number) {
  const secs = Math.max(30, Math.min(TEST_RUN_MAX_SECONDS, Math.round(seconds)))
  const stop = await rachioPut(key, '/device/stop_water', { id: deviceId })
  if (!stop.ok) return stop
  return rachioPut(key, '/zone/start', { id: zoneId, duration: secs })
}

/** Stop all watering on the controller. */
export async function stopRachioWater(key: string, deviceId: string) {
  return rachioPut(key, '/device/stop_water', { id: deviceId })
}

/** Check a key before saving it (Admin → Integrations). */
export async function validateRachioKey(key: string): Promise<{ ok: boolean; reachable: boolean; status?: number | null; account?: string }> {
  const info = await rachioGet<{ id: string }>(key, '/person/info')
  if (!info.ok) return { ok: false, reachable: info.reachable, status: info.status }
  const person = await rachioGet<RachioPerson>(key, `/person/${encodeURIComponent(info.data.id)}`)
  return { ok: true, reachable: true, account: person.ok ? (person.data.fullName || person.data.username || person.data.email) : undefined }
}

// ── Rachio shapes (only what we read) ─────────────────────────────────────────

type Named = { name?: string } | null | undefined
type RachioZone = {
  id: string
  zoneNumber?: number
  name?: string
  enabled?: boolean
  customNozzle?: Named
  customShade?: Named
  customSlope?: Named
  customCrop?: Named
  customSoil?: Named
}
type RachioRule = {
  id?: string
  name?: string
  enabled?: boolean
  zones?: { zoneId: string; duration?: number }[]
  scheduleJobTypes?: string[]
  startHour?: number
  startMinute?: number
  startTime?: number | string
}
type RachioDevice = {
  id: string
  name?: string
  model?: string
  status?: string
  on?: boolean
  latitude?: number
  longitude?: number
  zones?: RachioZone[]
  scheduleRules?: RachioRule[]
  flexScheduleRules?: RachioRule[]
}
type RachioPerson = { id: string; username?: string; fullName?: string; email?: string; devices?: RachioDevice[]; managedDevices?: RachioDevice[] }

// Oct 7 2026: Heroes' account has ~127 controllers shared with it; the whole
// account comes back as ONE ~1.5 MB reply that takes ~20 s. So: a long timeout,
// a 30-minute cache per company (the picker only needs names + locations), and
// the form starts this read as soon as the inspection opens. The import itself
// re-reads just the chosen controller (/device/:id — quick and current).
const cache = new Map<string, { at: number; devices: RachioDevice[] }>()
const inflight = new Map<string, Promise<RachioDevice[] | { error: string }>>()
const CACHE_MS = 30 * 60 * 1000

export async function loadRachioDevices(key: string, companyId: string): Promise<RachioDevice[] | { error: string }> {
  const hit = cache.get(companyId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.devices
  // Two taps (or the prefetch + a tap) share one read instead of two 20-second ones.
  const running = inflight.get(companyId)
  if (running) return running
  const job = (async (): Promise<RachioDevice[] | { error: string }> => {
    const info = await rachioGet<{ id: string }>(key, '/person/info')
    if (!info.ok) return { error: info.reachable ? `Rachio refused the company's key (${info.status}). Check it in Admin → Integrations.` : 'Could not reach Rachio — try again in a moment.' }
    const person = await rachioGet<RachioPerson>(key, `/person/${encodeURIComponent(info.data.id)}`, 60_000)
    if (!person.ok) return { error: person.reachable ? `Rachio returned an error (${person.status}).` : 'Rachio took too long to answer — try again in a moment.' }
    const seen = new Set<string>()
    const devices = [...(person.data.devices ?? []), ...(person.data.managedDevices ?? [])].filter(d => d?.id && !seen.has(d.id) && seen.add(d.id))
    cache.set(companyId, { at: Date.now(), devices })
    return devices
  })()
  inflight.set(companyId, job)
  try { return await job } finally { inflight.delete(companyId) }
}

/** One controller, fresh (zones + schedules) — for the import itself. */
export async function loadRachioDevice(key: string, deviceId: string): Promise<RachioDevice | { error: string }> {
  const d = await rachioGet<RachioDevice>(key, `/device/${encodeURIComponent(deviceId)}`, 20_000)
  if (!d.ok) return { error: d.status === 404 ? 'That controller isn’t on the company’s Rachio account any more.' : d.reachable ? `Rachio returned an error (${d.status}).` : 'Could not reach Rachio — try again in a moment.' }
  return d.data
}

// ── Picking the customer's controller ────────────────────────────────────────

export type RachioChoice = { id: string; name: string; model: string; zones: number; miles: number | null; online: boolean; match: boolean }

/** What we know about the customer, to find their controller among many. */
export type RachioCustomerHint = { lastName: string; firstName: string; street: string; at: { lat: number; lng: number } | null }

function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Controllers on the account, the customer's most likely first. Oct 7 2026:
 * Heroes' controllers are named like "Jane Smith-123 Oak St", and none of our
 * Jobber properties carry coordinates — so a name / street match ranks first,
 * then distance (from a work-order stop's pin or the geocoded address), then
 * name. A match is flagged so the picker can highlight it.
 */
export function rankRachioDevices(devices: RachioDevice[], hint: RachioCustomerHint): RachioChoice[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const last = norm(hint.lastName), first = norm(hint.firstName)
  const streetNum = hint.street.match(/^\s*(\d+)/)?.[1] ?? ''
  const streetWord = norm(hint.street.replace(/^\s*\d+\s*/, '')).split(' ').find(w => w.length > 2 && !['the', 'north', 'south', 'east', 'west'].includes(w)) ?? ''
  const score = (name: string) => {
    const n = ` ${norm(name)} `
    let sc = 0
    if (last && last.length > 1 && n.includes(` ${last} `)) sc += 4
    if (first && first.length > 1 && n.includes(` ${first} `)) sc += 1
    if (streetNum && n.includes(` ${streetNum} `)) sc += 3
    if (streetWord && n.includes(` ${streetWord} `)) sc += 2
    return sc
  }
  return devices.map(d => {
    const name = (d.name || 'Rachio controller').trim()
    return {
      id: d.id,
      name,
      model: prettyModel(d.model),
      zones: (d.zones ?? []).filter(z => z.enabled !== false).length,
      miles: hint.at && typeof d.latitude === 'number' && typeof d.longitude === 'number' ? Math.round(milesBetween(hint.at, { lat: d.latitude, lng: d.longitude }) * 10) / 10 : null,
      online: d.status ? d.status === 'ONLINE' : true,
      sc: score(name),
    }
  }).sort((a, b) => b.sc - a.sc || (a.miles ?? 1e9) - (b.miles ?? 1e9) || a.name.localeCompare(b.name))
    .map(({ sc, ...c }) => ({ ...c, match: sc >= 4 || (c.miles != null && c.miles < 0.1) }))
}

// ── Mapping Rachio → the inspection form ─────────────────────────────────────

function prettyModel(model: string | undefined): string {
  // e.g. GENERATION3_8ZONE → "Gen 3 · 8-zone"
  const m = String(model ?? '')
  const gen = m.match(/GENERATION(\d+)/i)?.[1]
  const zones = m.match(/(\d+)ZONE/i)?.[1]
  const parts = [gen ? `Gen ${gen}` : '', zones ? `${zones}-zone` : ''].filter(Boolean)
  return parts.length ? parts.join(' · ') : m.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

const has = (v: string, ...words: string[]) => words.some(w => v.includes(w))
/** Rachio sends codes like LOTS_OF_SUN / FIXED_SPRAY_HEAD / FOUR_SIX — read them as words. */
const words = (n: Named) => (n?.name ?? '').toLowerCase().replace(/_/g, ' ').trim()

function headFrom(n: Named): string {
  const v = words(n)
  if (v === 'unrecognized') return ''
  if (!v) return ''
  if (has(v, 'rotary nozzle', 'rotator', 'mp ')) return 'MP Rotator'
  if (has(v, 'rotor')) return 'Rotor'
  if (has(v, 'spray')) return 'Spray'
  if (has(v, 'drip', 'emitter')) return 'Drip'
  if (has(v, 'bubbler')) return 'Bubbler'
  if (has(v, 'mist', 'micro')) return 'Micro'
  return matchZoneOption('head', v)
}
function sunFrom(n: Named): string {
  const v = words(n)
  if (!v) return ''
  if (has(v, 'lots of sun', 'full sun', 'sunny')) return 'Full sun'
  if (has(v, 'lots of shade', 'full shade', 'mostly shade')) return 'Shade'
  if (has(v, 'shade', 'partial', 'part')) return 'Part sun'
  return matchZoneOption('sun', v)
}
function slopeFrom(n: Named): string {
  const v = words(n)
  if (!v) return ''
  // Rachio's bands: ZERO_THREE (0–3 %), FOUR_SIX (4–6 %), SEVEN_TWELVE (7–12 %),
  // OVER_TWELVE (> 12 %) → our Flat / Slight / Steep.
  if (v === 'zero three') return 'Flat'
  if (v === 'four six' || v === 'seven twelve') return 'Slight'
  if (v === 'over twelve') return 'Steep'
  if (has(v, 'flat', 'zero', 'none', 'level')) return 'Flat'
  if (has(v, 'steep', 'severe', 'high')) return 'Steep'
  if (has(v, 'slight', 'moderate', 'gentle', 'low')) return 'Slight'
  return matchZoneOption('slope', v)
}
function watersFrom(n: Named): string {
  const v = words(n)
  if (!v) return ''
  if (has(v, 'grass', 'turf', 'lawn')) return 'Turf'
  if (has(v, 'shrub')) return 'Shrub beds'
  if (has(v, 'annual', 'perennial', 'flower')) return 'Flower beds'
  if (has(v, 'tree')) return 'Trees'
  if (has(v, 'garden', 'vegetable')) return 'Garden'
  return matchZoneOption('waters', v)
}

/** Rachio DAY_OF_WEEK_n (0 = Sunday) → the form's Mon…Sun values. */
function daysFrom(types: string[] | undefined): string[] {
  const order = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const out = new Set<string>()
  for (const t of types ?? []) {
    const n = t.match(/^DAY_OF_WEEK_(\d)$/)?.[1]
    if (n != null && order[Number(n)]) out.add(order[Number(n)])
  }
  return WEEKDAYS.filter(d => out.has(d))
}

function startFrom(r: RachioRule): string | null {
  if (typeof r.startHour === 'number' && typeof r.startMinute === 'number') {
    return `${String(r.startHour).padStart(2, '0')}:${String(r.startMinute).padStart(2, '0')}`
  }
  return null
}

export type RachioImport = {
  /** System + schedule fields for the form's photo-style merge (blanks only). */
  system: Partial<IrrigationData>
  systemFields: string[]
  /** Zone cards for the dictation-style merge (blanks only, marked for review). */
  zones: DictatedZone[]
  /** What couldn't come across, said plainly. */
  notes: string[]
  controllerName: string
  /** Remembered on the inspection so ▶ Test run zones knows the controller. */
  deviceId: string
}

export function rachioToInspection(d: RachioDevice): RachioImport {
  const zonesAll = (d.zones ?? []).slice().sort((a, b) => (a.zoneNumber ?? 0) - (b.zoneNumber ?? 0))
  const enabled = zonesAll.filter(z => z.enabled !== false)
  const rules = [...(d.scheduleRules ?? []), ...(d.flexScheduleRules ?? [])]
  const active = rules.filter(r => r.enabled !== false)

  // Run time per zone: the longest minutes any active schedule gives it.
  const minutes = new Map<string, number>()
  for (const r of active) for (const z of r.zones ?? []) {
    const m = Math.round((z.duration ?? 0) / 60)
    if (m > 0) minutes.set(z.zoneId, Math.max(minutes.get(z.zoneId) ?? 0, m))
  }

  const zones: DictatedZone[] = enabled.map(z => ({
    zone: cleanZoneNumber(z.zoneNumber),
    area: (z.name ?? '').trim().slice(0, 200),
    head: headFrom(z.customNozzle),
    sun: sunFrom(z.customShade),
    slope: slopeFrom(z.customSlope),
    waters: watersFrom(z.customCrop),
    runtime: minutes.get(z.id) ? String(minutes.get(z.id)) : '',
    // No `mode`: blanks only — never over something the tech typed.
  })).map(z => Object.fromEntries(Object.entries(z).filter(([, v]) => v !== '')) as DictatedZone)

  const days = Array.from(new Set(active.flatMap(r => daysFrom(r.scheduleJobTypes))))
  const starts = Array.from(new Set(active.map(startFrom).filter((s): s is string => !!s))).sort()
  const model = prettyModel(d.model)
  const totalZones = Number(String(d.model ?? '').match(/(\d+)ZONE/i)?.[1] ?? 0) || zonesAll.length

  const system: Partial<IrrigationData> = {
    ctrlBrand: 'Rachio',
    ...(model ? { ctrlModel: model } : {}),
    ctrlType: 'Smart / Wi-Fi',
    ...(totalZones ? { stationsTotal: String(totalZones) } : {}),
    stationsUsed: String(enabled.length),
    ...(days.length ? { schedDays: WEEKDAYS.filter(x => days.includes(x)) } : {}),
    ...(starts.length ? { schedStarts: starts } : {}),
  }
  const notes: string[] = []
  if (!active.length) notes.push('No active schedule on the controller, so no watering days or run times came across.')
  else if (!starts.length) notes.push('The schedule is set to finish by sunrise rather than start at a set time — add start times by hand if you want them on the report.')
  else if (active.some(r => !startFrom(r))) notes.push('One schedule finishes by sunrise instead of a set start time — only the set start times came across.')
  if (active.some(r => (r.scheduleJobTypes ?? []).some(t => !/^DAY_OF_WEEK_/.test(t)))) notes.push('A schedule runs on an interval / odd-even days, not set weekdays — check the watering days.')
  if (zonesAll.length > enabled.length) notes.push(`${zonesAll.length - enabled.length} zone(s) are turned off in Rachio and were left out.`)

  return { system, systemFields: Object.keys(system), zones, notes, controllerName: (d.name || 'Rachio controller').trim(), deviceId: d.id }
}

/** The controller's zones for the test run, in zone order (enabled only). */
export function testRunZones(d: RachioDevice): { id: string; number: number; name: string }[] {
  return (d.zones ?? []).filter(z => z.enabled !== false)
    .map(z => ({ id: z.id, number: z.zoneNumber ?? 0, name: (z.name ?? '').trim() }))
    .sort((a, b) => a.number - b.number)
}
