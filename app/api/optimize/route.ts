import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { geocodeAddresses } from '@/lib/geocode'
import { haversineKm, twoOptTSP } from '@/lib/tsp'
import type { DurationRulesConfig } from '@/app/api/settings/types'
import { DEFAULT_DURATION_RULES } from '@/app/api/settings/types'

const FALLBACK_DEPOT = { lat: 30.2018, lng: -95.6972 }
const FALLBACK_SERVICE_MIN = 30
const FALLBACK_DRIVE_MPH = 25
const KM_PER_MILE = 1.60934

interface OptimizeRequest {
  addresses: string[]
  jobTitles?: string[]           // parallel to addresses
  visitLineItems?: string[][]    // parallel to addresses — line item names per stop
  visitTypes?: string[]          // parallel to addresses — 'visit' | 'assessment'
  startHour?: number
  date?: string
  lockedFirstIdx?: number
  lockedLastIdx?: number
  durationMethod?: string        // override from main screen dropdown
}

// ── Duration calculation ─────────────────────────────────────────────────────

function parseLawnSizeK(jobTitle: string): number | null {
  const m = jobTitle.match(/(\d+(?:\.\d+)?)\s*[Kk](?:\s|$)/)
  return m ? parseFloat(m[1]) : null
}

/**
 * Compute on-site duration for a single stop.
 * Returns { minutes, usedFallback, reason }
 */
function computeDuration(
  lineItemNames: string[],
  jobTitle: string,
  isAssessment: boolean,
  method: string,
  rules: DurationRulesConfig,
  fallbackMin: number,
): { minutes: number; usedFallback: boolean } {

  // Assessments always use fixed duration regardless of method
  if (isAssessment) {
    return { minutes: Math.max(rules.minMinutes, rules.assessmentMinutes), usedFallback: false }
  }

  if (method === 'default') {
    return { minutes: Math.max(rules.minMinutes, fallbackMin), usedFallback: false }
  }

  if (method === 'formula') {
    // Sum minutes for all matching line items (case-insensitive exact match)
    let total = 0
    let anyMatched = false
    for (const code of rules.codes) {
      if (!code.lineItemName) continue
      const matched = lineItemNames.some(
        li => li.trim().toLowerCase() === code.lineItemName.trim().toLowerCase()
      )
      if (matched) { total += code.minutes; anyMatched = true }
    }

    // Add lawn size if enabled
    if (rules.useLawnSize) {
      const lawnK = parseLawnSizeK(jobTitle)
      if (lawnK !== null) total += lawnK
    }

    // Add padding
    total += rules.padMinutes

    // If nothing matched at all, fall back to default
    if (!anyMatched && lineItemNames.length > 0) {
      return { minutes: Math.max(rules.minMinutes, fallbackMin), usedFallback: true }
    }

    return { minutes: Math.max(rules.minMinutes, total), usedFallback: false }
  }

  // Fallthrough — unknown method
  return { minutes: Math.max(rules.minMinutes, fallbackMin), usedFallback: true }
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

async function fetchDurationMatrix(
  points: Array<{ lat: number; lng: number }>,
  token: string
): Promise<number[][] | null> {
  try {
    const coordStr = points.map(p => `${p.lng},${p.lat}`).join(';')
    const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coordStr}?sources=all&destinations=all&access_token=${token}`
    // The Mapbox token is referrer-restricted to lynxedo.com — a server-side call
    // (no browser Referer) 403s without this header, which silently dropped every
    // route to straight-line distances instead of real road times.
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { Referer: process.env.NEXT_PUBLIC_APP_URL || 'https://lynxedo.com' },
    })
    if (!res.ok) return null
    const data = await res.json() as { code: string; durations: number[][] }
    return data.code === 'Ok' ? data.durations : null
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    addresses, jobTitles, visitLineItems, visitTypes,
    startHour = 8, date, lockedFirstIdx, lockedLastIdx,
    durationMethod: methodOverride,
  }: OptimizeRequest = await req.json()

  if (!addresses || addresses.length === 0)
    return NextResponse.json({ error: 'No addresses provided' }, { status: 400 })

  // Load company-wide routing settings (admins configure these in /admin/routing)
  const { data: hubUser } = await supabase
    .from('hub_users')
    .select('company_id')
    .eq('id', user.id)
    .maybeSingle()

  const { data: settings } = hubUser?.company_id
    ? await supabase
        .from('company_routing_settings')
        .select('depot_lat, depot_lng, default_service_minutes, default_drive_mph, duration_method, duration_rules')
        .eq('company_id', hubUser.company_id)
        .maybeSingle()
    : { data: null }

  const depot = (settings?.depot_lat != null && settings?.depot_lng != null)
    ? { lat: settings.depot_lat as number, lng: settings.depot_lng as number }
    : FALLBACK_DEPOT
  const serviceMin = settings?.default_service_minutes ?? FALLBACK_SERVICE_MIN
  const mph = settings?.default_drive_mph ?? FALLBACK_DRIVE_MPH
  const avgSpeedKmh = mph * KM_PER_MILE

  // Duration method: client override takes priority, then saved setting
  const method = methodOverride ?? (settings?.duration_method as string) ?? 'default'
  const rules: DurationRulesConfig = {
    ...DEFAULT_DURATION_RULES,
    ...((settings?.duration_rules as Partial<DurationRulesConfig>) ?? {}),
  }

  // Geocode all addresses — cached batch (#29): known recurring-customer
  // addresses are served from geocode_cache instead of re-hitting the geocoder.
  const coords = await geocodeAddresses(addresses)
  const geocodeFailed = coords.map((c, i) => c === null ? i : -1).filter(i => i !== -1)
  const validStops: { originalIndex: number; coord: { lat: number; lng: number } }[] = []
  coords.forEach((c, i) => { if (c !== null) validStops.push({ originalIndex: i, coord: c }) })
  if (validStops.length === 0)
    return NextResponse.json({ error: 'No addresses could be geocoded' }, { status: 422 })

  // ── Group same-address visits so they're never split by the optimizer ────
  // Two visits to the same address become one TSP node; they appear consecutively
  // in the final route with 0 drive time between them.
  const normalizeAddr = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

  interface AddressGroup {
    coord: { lat: number; lng: number }
    vsIndices: number[]  // indices into validStops[]
  }

  const groupMap = new Map<string, AddressGroup>()
  for (let i = 0; i < validStops.length; i++) {
    const key = normalizeAddr(addresses[validStops[i].originalIndex])
    if (!groupMap.has(key)) {
      groupMap.set(key, { coord: validStops[i].coord, vsIndices: [i] })
    } else {
      groupMap.get(key)!.vsIndices.push(i)
    }
  }
  const uniqueGroups = Array.from(groupMap.values())

  // Matrix API — one point per unique address (not per visit)
  const allPoints = [depot, ...uniqueGroups.map(g => g.coord)]
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
  let durationMatrix: number[][] | null = null
  if (mapboxToken && allPoints.length <= 25)
    durationMatrix = await fetchDurationMatrix(allPoints, mapboxToken)
  const usingMatrix = durationMatrix !== null

  // Locked stops — resolve to group indices
  // (durationMatrix index: 0=depot, gi+1=uniqueGroups[gi])
  let lockedFirstGroupIdx: number | null = null
  let lockedLastGroupIdx: number | null = null
  if (lockedFirstIdx != null && lockedFirstIdx >= 0) {
    const gi = uniqueGroups.findIndex(g =>
      g.vsIndices.some(vi => validStops[vi].originalIndex === lockedFirstIdx)
    )
    if (gi !== -1) lockedFirstGroupIdx = gi
  }
  if (lockedLastIdx != null && lockedLastIdx >= 0) {
    const gi = uniqueGroups.findIndex(g =>
      g.vsIndices.some(vi => validStops[vi].originalIndex === lockedLastIdx)
    )
    if (gi !== -1 && gi !== lockedFirstGroupIdx) lockedLastGroupIdx = gi
  }

  const poolGroupIndices = uniqueGroups.map((_, i) => i)
    .filter(i => i !== lockedFirstGroupIdx && i !== lockedLastGroupIdx)
  const poolGroups = poolGroupIndices.map(i => uniqueGroups[i])

  let poolMatrix: number[][] | null = null
  if (durationMatrix && poolGroups.length > 0) {
    const matIdxs = [0, ...poolGroupIndices.map(i => i + 1)]
    poolMatrix = matIdxs.map(ri => matIdxs.map(ci => durationMatrix![ri][ci]))
  }

  // Build TSP anchors so the solver optimizes the middle stops as
  //   lockedFirst → middle[0] → … → middle[n-1] → lockedLast
  // instead of always using the depot as both bookends. When a side is
  // unlocked it falls back to the depot, which matches the pre-pin behavior.
  const startAnchor = lockedFirstGroupIdx !== null
    ? uniqueGroups[lockedFirstGroupIdx].coord
    : depot
  const endAnchor = lockedLastGroupIdx !== null
    ? uniqueGroups[lockedLastGroupIdx].coord
    : depot
  let startCosts: number[] | undefined
  let endCosts: number[] | undefined
  if (durationMatrix && poolGroups.length > 0) {
    const startMatIdx = lockedFirstGroupIdx !== null ? lockedFirstGroupIdx + 1 : 0
    const endMatIdx = lockedLastGroupIdx !== null ? lockedLastGroupIdx + 1 : 0
    startCosts = poolGroupIndices.map(pi => durationMatrix![startMatIdx][pi + 1])
    endCosts = poolGroupIndices.map(pi => durationMatrix![pi + 1][endMatIdx])
  }

  const poolLocalGroupOrder = poolGroups.length > 1
    ? twoOptTSP(
        poolGroups.map(g => g.coord),
        depot,
        poolMatrix ?? undefined,
        { startAnchor, endAnchor, startCosts, endCosts },
      )
    : poolGroups.map((_, i) => i)

  const localGroupOrder: number[] = []
  if (lockedFirstGroupIdx !== null) localGroupOrder.push(lockedFirstGroupIdx)
  localGroupOrder.push(...poolLocalGroupOrder.map(pi => poolGroupIndices[pi]))
  if (lockedLastGroupIdx !== null) localGroupOrder.push(lockedLastGroupIdx)

  // Expand groups → individual stops in visit order
  // stopGroupMatIdx[i]: matrix index for stop i's group (gi+1); same for all group members
  // stopWithinGroup[i]: 0 = first visit at this address, 1 = second, etc.
  const order: number[] = []
  const orderedCoords: { lat: number; lng: number }[] = []
  const stopGroupMatIdx: number[] = []
  const stopWithinGroup: number[] = []

  for (const gi of localGroupOrder) {
    const group = uniqueGroups[gi]
    const matIdx = gi + 1
    for (let wi = 0; wi < group.vsIndices.length; wi++) {
      order.push(validStops[group.vsIndices[wi]].originalIndex)
      orderedCoords.push(group.coord)
      stopGroupMatIdx.push(matIdx)
      stopWithinGroup.push(wi)
    }
  }

  // Build legs
  // wi === 0: first visit at an address — normal drive time from previous location
  // wi  > 0: subsequent visit at same address — 0 drive, 0 distance
  interface Leg {
    distanceKm: number; driveMinutes: number; onSiteMinutes: number
    arrivalTime: string; startAtISO: string | null; endAtISO: string | null
    usedFallback: boolean
  }
  const legs: Leg[] = []
  let elapsedMin = startHour * 60
  let prevGroupMatIdx = 0  // 0 = depot
  let prevCoord = depot

  for (let i = 0; i < orderedCoords.length; i++) {
    const coord = orderedCoords[i]
    const currMatIdx = stopGroupMatIdx[i]
    const wi = stopWithinGroup[i]

    let driveMin = 0
    let distKm = 0

    if (wi === 0) {
      // Moving to a new address
      distKm = Math.round(haversineKm(prevCoord, coord) * 10) / 10
      if (usingMatrix && durationMatrix) {
        driveMin = Math.round(durationMatrix[prevGroupMatIdx][currMatIdx] / 60)
      } else {
        driveMin = Math.round((distKm / avgSpeedKmh) * 60)
      }
      prevGroupMatIdx = currMatIdx
      prevCoord = coord
    }
    // wi > 0: same address — driveMin and distKm stay 0

    elapsedMin += driveMin

    const originalIdx = order[i]
    const title = jobTitles?.[originalIdx] ?? ''
    const lineItems = visitLineItems?.[originalIdx] ?? []
    const isAssessment = visitTypes?.[originalIdx] === 'assessment'

    const { minutes: onSiteMin, usedFallback } = computeDuration(
      lineItems, title, isAssessment, method, rules, serviceMin
    )

    legs.push({
      distanceKm: distKm, driveMinutes: driveMin, onSiteMinutes: onSiteMin,
      arrivalTime: fmtTime(elapsedMin),
      startAtISO: date ? toISOLocal(date, elapsedMin) : null,
      endAtISO: date ? toISOLocal(date, elapsedMin + onSiteMin) : null,
      usedFallback,
    })
    elapsedMin += onSiteMin
  }

  return NextResponse.json({
    order, legs, geocodeFailed, coords: orderedCoords, depotCoord: depot,
    usingMatrix, durationMatrix,
    matrixIndices: stopGroupMatIdx,  // per-stop; same-address stops share a matrix index → 0 drive on recalculate
    avgSpeedKmh,
    method,
  })
}
