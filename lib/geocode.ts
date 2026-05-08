export interface LatLng {
  lat: number
  lng: number
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
