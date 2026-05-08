import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { geocodeAddress } from '@/lib/geocode'
import { haversineKm, twoOptTSP } from '@/lib/tsp'

// Depot: 27313 Dobbin Huffsmith Rd, Magnolia TX 77354
const DEPOT = { lat: 30.2018, lng: -95.6972 }

const AVG_SPEED_KMH = 40.23   // ~25 mph suburban average
const SERVICE_TIME_MIN = 30    // default service time per stop

interface OptimizeRequest {
  addresses: string[]
  startHour?: number  // decimal 24-hr, e.g. 8.5 = 8:30 AM, defaults to 8
  date?: string       // YYYY-MM-DD — if provided, legs include startAtISO/endAtISO
}

function fmtTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = Math.round(totalMinutes % 60)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
}

function toISOLocal(date: string, totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = Math.round(totalMinutes % 60)
  return `${date}T${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`
}

export async function POST(req: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { addresses, startHour = 8, date }: OptimizeRequest = await req.json()
  if (!addresses || addresses.length === 0) {
    return NextResponse.json({ error: 'No addresses provided' }, { status: 400 })
  }

  // Geocode all addresses in parallel
  const coords = await Promise.all(addresses.map(a => geocodeAddress(a)))

  // Track which failed
  const geocodeFailed: number[] = coords
    .map((c, i) => (c === null ? i : -1))
    .filter(i => i !== -1)

  // Build valid stops list with original index
  const validStops: { originalIndex: number; coord: { lat: number; lng: number } }[] = []
  coords.forEach((c, i) => {
    if (c !== null) validStops.push({ originalIndex: i, coord: c })
  })

  if (validStops.length === 0) {
    return NextResponse.json({ error: 'No addresses could be geocoded' }, { status: 422 })
  }

  // Run 2-opt TSP on geocoded coords
  const localOrder = twoOptTSP(validStops.map(s => s.coord), DEPOT)

  // Map back to original visit indices
  const order: number[] = localOrder.map(li => validStops[li].originalIndex)
  const orderedCoords = localOrder.map(li => validStops[li].coord)

  // Build per-leg drive times and ETAs
  interface Leg {
    distanceKm: number
    driveMinutes: number
    arrivalTime: string
    startAtISO: string | null  // local ISO "YYYY-MM-DDTHH:MM:SS" (America/Chicago)
    endAtISO: string | null    // startAt + SERVICE_TIME_MIN
  }
  const legs: Leg[] = []
  let elapsedMin = startHour * 60
  let prev = DEPOT

  for (const coord of orderedCoords) {
    const distKm = haversineKm(prev, coord)
    const driveMin = (distKm / AVG_SPEED_KMH) * 60
    elapsedMin += driveMin
    legs.push({
      distanceKm: Math.round(distKm * 10) / 10,
      driveMinutes: Math.round(driveMin),
      arrivalTime: fmtTime(elapsedMin),
      startAtISO: date ? toISOLocal(date, elapsedMin) : null,
      endAtISO: date ? toISOLocal(date, elapsedMin + SERVICE_TIME_MIN) : null,
    })
    elapsedMin += SERVICE_TIME_MIN
    prev = coord
  }

  return NextResponse.json({ order, legs, geocodeFailed })
}
