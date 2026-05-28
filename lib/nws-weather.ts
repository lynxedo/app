// National Weather Service (api.weather.gov) — free, no API key, US-only.
// NWS docs: https://www.weather.gov/documentation/services-web-api
//
// Flow: /points/{lat,lng} → observationStations URL → station observation.
// The /points/ response is stable per address, so we cache the
// observationStations URL for 1h to skip step 1 on repeat lookups.

const POINTS_CACHE_TTL_MS = 60 * 60 * 1000 // 1h
const TOTAL_BUDGET_MS = 8000

// NWS asks for a User-Agent identifying the app + contact info so they can
// reach out if traffic looks abusive.
const USER_AGENT = 'Lynxedo Daily Log v2 (ben@heroeslawntx.com)'

interface PointsResponse {
  properties?: {
    observationStations?: string
  }
}

interface StationsResponse {
  features?: Array<{
    properties?: {
      stationIdentifier?: string
      name?: string
    }
  }>
}

interface ObservationProperties {
  timestamp?: string
  textDescription?: string
  temperature?: { value?: number | null; unitCode?: string }
  windSpeed?: { value?: number | null; unitCode?: string }
  windDirection?: { value?: number | null }
  relativeHumidity?: { value?: number | null }
  barometricPressure?: { value?: number | null }
}

interface ObservationResponse {
  properties?: ObservationProperties
}

export interface WeatherSnapshot {
  observed_at: string | null
  station_id: string | null
  station_name: string | null
  temperature_f: number | null
  temperature_c: number | null
  conditions: string | null
  wind_mph: number | null
  wind_direction: number | null
  humidity_pct: number | null
  source: 'nws'
  // Raw NWS observation properties — preserved for compliance/audit. Schema
  // shape comes straight from api.weather.gov; consumers should treat it as
  // opaque except for the typed fields above.
  raw: ObservationProperties | null
}

const pointsCache = new Map<string, { url: string; expiresAt: number }>()

function roundCoord(n: number): string {
  return n.toFixed(4)
}

function celsiusToFahrenheit(c: number): number {
  return Math.round((c * 9 / 5 + 32) * 10) / 10
}

function kphToMph(kph: number): number {
  return Math.round(kph * 0.621371 * 10) / 10
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/geo+json, application/json',
      },
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/**
 * Fetches the current observed weather from the nearest NWS station to a
 * (lat, lng) coordinate. Returns null on any failure (NWS down, no nearby
 * station, network timeout, coordinate outside US, etc.) — callers should
 * treat weather as best-effort and never block user-facing flows on it.
 *
 * Total budget across all 3 chained NWS calls is TOTAL_BUDGET_MS (8s).
 */
export async function fetchWeatherForLocation(
  lat: number,
  lng: number,
): Promise<WeatherSnapshot | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const cacheKey = `${roundCoord(lat)},${roundCoord(lng)}`

  const controller = new AbortController()
  const overallTimeout = setTimeout(() => controller.abort(), TOTAL_BUDGET_MS)

  try {
    // Step 1: resolve observation-stations URL (1h cache — stable per address)
    let stationsUrl: string | null = null
    const cached = pointsCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      stationsUrl = cached.url
    } else {
      const pointsUrl = `https://api.weather.gov/points/${cacheKey}`
      const points = await fetchJson<PointsResponse>(pointsUrl, controller.signal)
      stationsUrl = points?.properties?.observationStations ?? null
      if (stationsUrl) {
        pointsCache.set(cacheKey, {
          url: stationsUrl,
          expiresAt: Date.now() + POINTS_CACHE_TTL_MS,
        })
      }
    }
    if (!stationsUrl) return null

    // Step 2: nearest station (NWS returns sorted by distance)
    const stations = await fetchJson<StationsResponse>(stationsUrl, controller.signal)
    const firstStation = stations?.features?.[0]?.properties
    const stationId = firstStation?.stationIdentifier ?? null
    const stationName = firstStation?.name ?? null
    if (!stationId) return null

    // Step 3: latest observation
    const obsUrl = `https://api.weather.gov/stations/${stationId}/observations/latest`
    const obs = await fetchJson<ObservationResponse>(obsUrl, controller.signal)
    const p = obs?.properties
    if (!p) return null

    const tempC = p.temperature?.value
    const windKph = p.windSpeed?.value

    return {
      observed_at: p.timestamp ?? null,
      station_id: stationId,
      station_name: stationName,
      temperature_c: typeof tempC === 'number' ? Math.round(tempC * 10) / 10 : null,
      temperature_f: typeof tempC === 'number' ? celsiusToFahrenheit(tempC) : null,
      conditions: p.textDescription ?? null,
      wind_mph: typeof windKph === 'number' ? kphToMph(windKph) : null,
      wind_direction: typeof p.windDirection?.value === 'number' ? Math.round(p.windDirection.value) : null,
      humidity_pct: typeof p.relativeHumidity?.value === 'number' ? Math.round(p.relativeHumidity.value) : null,
      source: 'nws',
      raw: p,
    }
  } catch {
    return null
  } finally {
    clearTimeout(overallTimeout)
  }
}

/**
 * Format a WeatherSnapshot for compact UI display, e.g. "78°F, Partly Cloudy".
 * Returns null if no useful data is present.
 */
export function formatWeatherSummary(w: WeatherSnapshot | null | undefined): string | null {
  if (!w) return null
  const parts: string[] = []
  if (typeof w.temperature_f === 'number') parts.push(`${w.temperature_f}°F`)
  if (w.conditions) parts.push(w.conditions)
  return parts.length > 0 ? parts.join(', ') : null
}
