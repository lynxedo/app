import { createAdminClient } from '@/lib/supabase/admin'

export interface LatLng {
  lat: number
  lng: number
}

// #29 — normalize an address to a stable cache key (case/whitespace-insensitive).
function geocodeKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Batch geocode with a persistent cache (geocode_cache table). Recurring-customer
// addresses are re-used across every route build, so a known address becomes a
// single DB lookup instead of an external geocoder round-trip. Returns coords in
// the same order as the input. Falls back to direct geocoding if the cache is
// unavailable, so this can never make geocoding *worse* than before.
export async function geocodeAddresses(addresses: string[]): Promise<(LatLng | null)[]> {
  const keys = addresses.map(geocodeKey)
  const uniqueKeys = [...new Set(keys.filter(Boolean))]
  const found = new Map<string, LatLng>()

  if (uniqueKeys.length) {
    try {
      const admin = createAdminClient()
      for (let i = 0; i < uniqueKeys.length; i += 200) {
        const slice = uniqueKeys.slice(i, i + 200)
        const { data } = await admin
          .from('geocode_cache')
          .select('address_key, lat, lng')
          .in('address_key', slice)
        for (const r of data ?? []) found.set(r.address_key, { lat: Number(r.lat), lng: Number(r.lng) })
      }
    } catch { /* cache unavailable; fall through to direct geocoding */ }
  }

  // Geocode only the addresses we didn't find in the cache.
  const keyToAddress = new Map<string, string>()
  addresses.forEach((a, i) => { if (!keyToAddress.has(keys[i])) keyToAddress.set(keys[i], a) })
  const misses = uniqueKeys.filter(k => !found.has(k))
  if (misses.length) {
    const results = await Promise.all(
      misses.map(async k => ({ k, ll: await geocodeAddress(keyToAddress.get(k) as string) }))
    )
    const toInsert: { address_key: string; lat: number; lng: number }[] = []
    for (const { k, ll } of results) {
      if (ll) { found.set(k, ll); toInsert.push({ address_key: k, lat: ll.lat, lng: ll.lng }) }
    }
    if (toInsert.length) {
      try {
        const admin = createAdminClient()
        await admin.from('geocode_cache').upsert(toInsert, { onConflict: 'address_key' })
      } catch { /* best-effort cache write */ }
    }
  }

  return keys.map(k => found.get(k) ?? null)
}

/**
 * Geocodes a single-line address using the US Census Geocoder (no auth required).
 * Returns { lat, lng } or null if the address couldn't be matched.
 */
export async function geocodeAddress(address: string): Promise<LatLng | null> {
  try {
    const url =
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` +
      `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null

    const data = await res.json()
    const matches = data?.result?.addressMatches
    if (!matches || matches.length === 0) return null

    const { x, y } = matches[0].coordinates // x = lng, y = lat
    return { lat: Number(y), lng: Number(x) }
  } catch {
    return null
  }
}
