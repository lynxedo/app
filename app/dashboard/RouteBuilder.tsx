'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import RoutePreviewMap, { type RoutePreviewPin } from '@/components/RoutePreviewMap'

interface JobberUser {
  id: string
  name: string
}

interface LineItem {
  name: string
  qty: number
  unitPrice: number
  totalPrice: number
}

interface Visit {
  stopNumber: number
  id: string
  clientName: string
  phone: string | null
  addressString: string
  services: string
  totalPrice: number
  lineItems: LineItem[]
  lineItemNames: string[]
  jobTitle: string
  instructions: string | null
  startAt: string | null
  type: 'visit' | 'assessment'
  // Originating Jobber user the visit was assigned to. Decorated client-side
  // during loadVisits so multi-tech routes can show which tech each stop
  // came from. May be empty for legacy data.
  techId?: string
}

interface OptimizedVisit extends Visit {
  eta: string
  driveMinutes: number
  onSiteMinutes: number
  distanceKm: number
  startAtISO: string | null
  endAtISO: string | null
  lat: number
  lng: number
  matrixIndex: number  // index in allPoints from optimize API (0=depot, 1..n=stops)
}

interface Leg {
  distanceKm: number
  driveMinutes: number
  onSiteMinutes: number
  arrivalTime: string
  startAtISO: string | null
  endAtISO: string | null
  usedFallback?: boolean
}

interface SendResult {
  visitId: string
  success: boolean
  error?: string
}

function todayLocal() {
  const d = new Date()
  return d.toISOString().split('T')[0]
}

// ── Client-side helpers (mirror of server-side equivalents) ──
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function fmtTimeClient(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = Math.round(totalMinutes % 60)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
}

function toISOLocalClient(date: string, totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = Math.round(totalMinutes % 60)
  return `${date}T${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`
}

// Precision-5 encoded polyline for Mapbox Static Images API path overlay
function encodePolyline5(pts: Array<{ lat: number; lng: number }>): string {
  let result = '', prevLat5 = 0, prevLng5 = 0
  function encCoord(n: number): string {
    let v = n < 0 ? ~(n << 1) : (n << 1)
    let s = ''
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>>= 5 }
    return s + String.fromCharCode(v + 63)
  }
  for (const p of pts) {
    const lat5 = Math.round(p.lat * 1e5)
    const lng5 = Math.round(p.lng * 1e5)
    result += encCoord(lat5 - prevLat5) + encCoord(lng5 - prevLng5)
    prevLat5 = lat5; prevLng5 = lng5
  }
  return result
}

export default function RouteBuilder() {
  const [users, setUsers] = useState<JobberUser[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState<string | null>(null)

  const [date, setDate] = useState(todayLocal())
  // Multi-select: array of Jobber user IDs whose visits to load. Order
  // doesn't matter; visits get tagged with their originating tech.
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [techPickerOpen, setTechPickerOpen] = useState(false)
  const techPickerRef = useRef<HTMLDivElement>(null)
  const [startTime, setStartTime] = useState('08:00')  // HH:MM

  const [visits, setVisits] = useState<Visit[] | null>(null)
  const [visitsLoading, setVisitsLoading] = useState(false)
  const [visitsError, setVisitsError] = useState<string | null>(null)

  // Per-visit geocoded coords (parallel array to visits[])
  const [visitCoords, setVisitCoords] = useState<Array<{ lat: number; lng: number } | null>>([])
  const [coordsLoading, setCoordsLoading] = useState(false)

  // Which stop IDs are checked (default: all on load)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Which stop IDs have been successfully sent to Jobber (stay greyed in the list)
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())

  const [optimizedVisits, setOptimizedVisits] = useState<OptimizedVisit[] | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)
  const [geocodeFailed, setGeocodeFailed] = useState<number[]>([])
  const [usingMatrix, setUsingMatrix] = useState<boolean | null>(null)

  // Depot coords (returned from optimize API, used for map)
  const [depotCoord, setDepotCoord] = useState<{ lat: number; lng: number } | null>(null)

  // Matrix / speed — stored for client-side ETA recalculation after drag-reorder
  const [durationMatrix, setDurationMatrix] = useState<number[][] | null>(null)
  const [avgSpeedKmh, setAvgSpeedKmh] = useState<number>(40)

  // Lock first/last stop before optimizing
  const [lockedFirstId, setLockedFirstId] = useState<string | null>(null)
  const [lockedLastId, setLockedLastId] = useState<string | null>(null)

  // Drag-to-reorder state
  const [isManualOrder, setIsManualOrder] = useState(false)
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // Duration method (loaded from settings, overridable per session)
  const [durationMethod, setDurationMethod] = useState<string>('default')
  const [fallbackStops, setFallbackStops] = useState<string[]>([])

  // Send to Jobber state
  const [reassignUserId, setReassignUserId] = useState<string>('__keep__')
  const [sending, setSending] = useState(false)
  const [sendResults, setSendResults] = useState<SendResult[] | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendMode, setSendMode] = useState<'times' | 'order' | null>(null)

  // Send to Daily Log state (independent — doesn't share `sending` so the user
  // can still see a Jobber send result while a daily-log send is in flight)
  const [sendingDailyLog, setSendingDailyLog] = useState(false)
  const [dailyLogResult, setDailyLogResult] = useState<{ stop_count: number; action: 'created' | 'updated' } | null>(null)
  const [dailyLogError, setDailyLogError] = useState<string | null>(null)

  // Send to Daily Log v1 state
  const [sendingDailyLogV1, setSendingDailyLogV1] = useState(false)
  const [dailyLogV1Result, setDailyLogV1Result] = useState<{ action: 'created' | 'updated' } | null>(null)
  const [dailyLogV1Error, setDailyLogV1Error] = useState<string | null>(null)

  // ── Computed pins for the interactive preview map ─────────────────────────
  // Pre-optimize: pins coloured by selection/sent state.
  // Post-optimize: numbered pins in route order; the map component draws the
  // actual driving polyline via Mapbox Directions API on top.
  const previewPins = useMemo<RoutePreviewPin[]>(() => {
    if (optimizedVisits && optimizedVisits.length > 0) {
      return optimizedVisits.map((v, i) => ({
        id: v.id,
        lat: v.lat,
        lng: v.lng,
        label: i < 9 ? String(i + 1) : String.fromCharCode(97 + (i - 9)),
        color: sentIds.has(v.id) ? '888888' : 'c0392b',
        title: `${v.stopNumber}. ${v.clientName}`,
      }))
    }
    if (!visits) return []
    const pins: RoutePreviewPin[] = []
    visits.forEach((v, i) => {
      const coord = visitCoords[i]
      if (!coord) return
      const isSent = sentIds.has(v.id)
      const isSelected = selectedIds.has(v.id)
      pins.push({
        id: v.id,
        lat: coord.lat,
        lng: coord.lng,
        label: i < 9 ? String(i + 1) : String.fromCharCode(97 + (i - 9)),
        color: isSent ? '888888' : isSelected ? 'e47200' : '555555',
        title: v.clientName,
      })
    })
    return pins
  }, [visits, visitCoords, selectedIds, sentIds, optimizedVisits])

  // Load settings on mount (get saved duration_method default)
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        if (data.settings?.duration_method) {
          setDurationMethod(data.settings.duration_method)
        }
      })
      .catch(() => {}) // non-critical
  }, [])

  // Load users on mount
  useEffect(() => {
    fetch('/api/users')
      .then(r => r.json())
      .then(data => {
        if (data.error) { setUsersError(data.error); return }
        setUsers(data.users)
        if (data.users.length > 0) setSelectedUserIds([data.users[0].id])
      })
      .catch(e => setUsersError(e.message))
      .finally(() => setUsersLoading(false))
  }, [])

  // Close tech picker on outside click
  useEffect(() => {
    if (!techPickerOpen) return
    const handler = (e: MouseEvent) => {
      if (techPickerRef.current && !techPickerRef.current.contains(e.target as Node)) {
        setTechPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [techPickerOpen])

  function toggleTech(id: string) {
    setSelectedUserIds(curr =>
      curr.includes(id) ? curr.filter(x => x !== id) : [...curr, id],
    )
  }
  const techLabel = (() => {
    if (selectedUserIds.length === 0) return 'Select team member'
    if (selectedUserIds.length === 1) {
      return users.find(u => u.id === selectedUserIds[0])?.name ?? '1 selected'
    }
    if (selectedUserIds.length === 2) {
      return selectedUserIds
        .map(id => users.find(u => u.id === id)?.name)
        .filter(Boolean)
        .join(' + ')
    }
    return `${selectedUserIds.length} team members`
  })()

  async function geocodeVisits(loadedVisits: Visit[]) {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
    if (!token || loadedVisits.length === 0) {
      setVisitCoords(loadedVisits.map(() => null))
      return
    }
    setCoordsLoading(true)
    const coords = await Promise.all(loadedVisits.map(async v => {
      try {
        const encoded = encodeURIComponent(v.addressString)
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=1&country=US`,
          { signal: AbortSignal.timeout(6000) }
        )
        const data = await res.json()
        const center = data.features?.[0]?.center
        return center ? { lng: center[0] as number, lat: center[1] as number } : null
      } catch {
        return null
      }
    }))
    setVisitCoords(coords)
    setCoordsLoading(false)
  }

  async function loadVisits() {
    if (selectedUserIds.length === 0) return
    setVisitsLoading(true)
    setVisitsError(null)
    setVisits(null)
    setOptimizedVisits(null)
    setOptimizeError(null)
    setGeocodeFailed([])
    setSendResults(null)
    setSendError(null)
    setDurationMatrix(null)
    setIsManualOrder(false)
    setLockedFirstId(null)
    setLockedLastId(null)
    setFallbackStops([])
    setVisitCoords([])
    setSelectedIds(new Set())
    setSentIds(new Set())
    try {
      // Fan out one /api/visits call per selected tech, tagging each returned
      // visit with the originating techId so the UI can show who it came from.
      const settled = await Promise.all(
        selectedUserIds.map(async uid => {
          const res = await fetch(`/api/visits?date=${date}&userId=${encodeURIComponent(uid)}`)
          const data = await res.json()
          if (data.error) throw new Error(data.error)
          return (data.visits as Visit[]).map(v => ({ ...v, techId: uid }))
        }),
      )
      const merged: Visit[] = settled.flat()
      // Stable: sort by tech first (in selection order), then preserve API order within each tech.
      const order = new Map(selectedUserIds.map((id, i) => [id, i]))
      merged.sort((a, b) => {
        const ai = order.get(a.techId ?? '') ?? 99
        const bi = order.get(b.techId ?? '') ?? 99
        return ai - bi
      })
      setVisits(merged)
      setSelectedIds(new Set(merged.map(v => v.id)))
      geocodeVisits(merged)  // async — updates visitCoords as pins load
    } catch (e) {
      setVisitsError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setVisitsLoading(false)
    }
  }

  async function optimizeRoute() {
    // Only optimize the selected (checked) visits
    const selectedVisits = (visits ?? []).filter(v => selectedIds.has(v.id))
    if (selectedVisits.length === 0) return
    setOptimizing(true)
    setOptimizeError(null)
    setGeocodeFailed([])
    setSendResults(null)
    setSendError(null)
    try {
      const addresses = selectedVisits.map(v => v.addressString)
      const jobTitles = selectedVisits.map(v => v.jobTitle)
      const [hh, mm] = startTime.split(':').map(Number)
      const startHour = hh + mm / 60

      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addresses,
          jobTitles,
          startHour,
          date,
          lockedFirstIdx: lockedFirstId ? selectedVisits.findIndex(v => v.id === lockedFirstId) : undefined,
          lockedLastIdx: lockedLastId ? selectedVisits.findIndex(v => v.id === lockedLastId) : undefined,
          visitLineItems: selectedVisits.map(v => v.lineItemNames ?? []),
          visitTypes: selectedVisits.map(v => v.type ?? 'visit'),
          durationMethod,
        }),
      })
      const data: {
        order: number[]
        legs: Leg[]
        geocodeFailed: number[]
        coords: Array<{ lat: number; lng: number }>
        depotCoord: { lat: number; lng: number }
        usingMatrix?: boolean
        durationMatrix?: number[][] | null
        matrixIndices?: number[]
        avgSpeedKmh?: number
        error?: string
      } = await res.json()
      if (data.error) { setOptimizeError(data.error); return }

      setGeocodeFailed(data.geocodeFailed ?? [])
      setUsingMatrix(data.usingMatrix ?? false)
      if (data.depotCoord) setDepotCoord(data.depotCoord)
      setDurationMatrix(data.durationMatrix ?? null)
      setAvgSpeedKmh(data.avgSpeedKmh ?? 40)
      setIsManualOrder(false)

      // Capture stops that fell back to default duration
      const fbStops = (data.legs ?? [])
        .map((leg: Leg, i: number) => leg.usedFallback ? selectedVisits[data.order[i]]?.clientName : null)
        .filter((n: string | null): n is string => !!n)
      setFallbackStops(fbStops)

      const reordered: OptimizedVisit[] = data.order.map((originalIdx, newPos) => ({
        ...selectedVisits[originalIdx],
        stopNumber: newPos + 1,
        eta: data.legs[newPos].arrivalTime,
        driveMinutes: data.legs[newPos].driveMinutes,
        onSiteMinutes: data.legs[newPos].onSiteMinutes,
        distanceKm: data.legs[newPos].distanceKm,
        startAtISO: data.legs[newPos].startAtISO,
        endAtISO: data.legs[newPos].endAtISO,
        lat: data.coords[newPos].lat,
        lng: data.coords[newPos].lng,
        matrixIndex: data.matrixIndices?.[newPos] ?? newPos + 1,
      }))
      setOptimizedVisits(reordered)
    } catch (e) {
      setOptimizeError(e instanceof Error ? e.message : 'Optimization failed')
    } finally {
      setOptimizing(false)
    }
  }

  function markSentLocal(results: SendResult[]) {
    const newlySentIds = new Set(results.filter(r => r.success).map(r => r.visitId))
    if (newlySentIds.size > 0) {
      setSentIds(prev => new Set([...prev, ...newlySentIds]))
      setSelectedIds(prev => {
        const next = new Set(prev)
        newlySentIds.forEach(id => next.delete(id))
        return next
      })
    }
  }

  async function sendToJobber() {
    if (!optimizedVisits) return

    // Multi-tech routes need a reassign target — appointment times computed
    // from a single optimized sequence don't make sense if half the stops stay
    // with Tech A and half with Tech B.
    if (selectedUserIds.length > 1 && reassignUserId === '__keep__') {
      setSendError('Multiple techs were loaded. Pick a target tech in "Reassign to" before sending times.')
      setSendMode('times')
      return
    }

    setSending(true)
    setSendError(null)
    setSendResults(null)
    setSendMode('times')

    const visitsPayload = optimizedVisits
      .filter(v => v.startAtISO && v.endAtISO)
      .map(v => ({ visitId: v.id, startAt: v.startAtISO!, endAt: v.endAtISO! }))

    if (visitsPayload.length === 0) {
      setSendError('No visits have timestamps — re-optimize to generate times.')
      setSending(false)
      return
    }

    try {
      const res = await fetch('/api/send-to-jobber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visits: visitsPayload,
          assignedUserId: reassignUserId === '__keep__' ? null : reassignUserId,
        }),
      })
      const data: { results: SendResult[]; allOk: boolean; error?: string } = await res.json()
      if (data.error) { setSendError(data.error); return }
      setSendResults(data.results)
      if (data.results) markSentLocal(data.results)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Failed to send to Jobber')
    } finally {
      setSending(false)
    }
  }

  async function sendOrderOnly() {
    if (!optimizedVisits || optimizedVisits.length === 0) return

    // Multi-tech routes MUST be reassigned to a single tech first — Jobber's
    // anytime stop order is per-tech, so chaining editAppointment mutations
    // across multiple techs is meaningless.
    if (selectedUserIds.length > 1 && reassignUserId === '__keep__') {
      setSendError('Multiple techs were loaded. Pick a target tech in "Reassign to" before sending the order.')
      setSendMode('order')
      return
    }

    setSending(true)
    setSendError(null)
    setSendResults(null)
    setSendMode('order')

    const visitIds = optimizedVisits.map(v => v.id)

    try {
      const res = await fetch('/api/reorder-jobber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visit_ids: visitIds,
          assigned_user_id: reassignUserId !== '__keep__' ? reassignUserId : null,
        }),
      })
      const data: { results: SendResult[]; allOk: boolean; error?: string } = await res.json()
      if (data.error) { setSendError(data.error); return }
      setSendResults(data.results)
      if (data.results) markSentLocal(data.results)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Failed to send order to Jobber')
    } finally {
      setSending(false)
    }
  }

  async function sendToDailyLog() {
    if (!optimizedVisits || optimizedVisits.length === 0) return

    // Daily Log is per-tech. Multi-tech routes need the same reassign target
    // the Jobber sends use — otherwise we don't know which tech to attach the
    // stops to.
    if (selectedUserIds.length > 1 && reassignUserId === '__keep__') {
      setDailyLogError('Multiple techs were loaded. Pick a target tech in "Reassign to" before sending to Daily Log.')
      return
    }

    const techJobberUserId = reassignUserId !== '__keep__'
      ? reassignUserId
      : selectedUserIds[0]
    const techJobberUserName = users.find(u => u.id === techJobberUserId)?.name ?? ''
    if (!techJobberUserName) {
      setDailyLogError('Could not resolve the target tech\'s name. Reload the page and try again.')
      return
    }

    setSendingDailyLog(true)
    setDailyLogError(null)
    setDailyLogResult(null)

    const stops = optimizedVisits.map(v => ({
      jobber_visit_id: v.id,
      client_name: v.clientName,
      client_phone: v.phone,
      address: v.addressString,
      lat: v.lat,
      lng: v.lng,
      job_title: v.jobTitle,
      line_items: v.lineItems,
      instructions: v.instructions,
      scheduled_start_at: v.startAtISO,
      scheduled_end_at: v.endAtISO,
      duration_minutes: v.onSiteMinutes,
    }))

    try {
      const res = await fetch('/api/hub/daily-log/from-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_date: date,
          tech_jobber_user_id: techJobberUserId,
          tech_jobber_user_name: techJobberUserName,
          stops,
        }),
      })
      const data = await res.json() as {
        entry_id?: string
        stop_count?: number
        action?: 'created' | 'updated'
        error?: string
      }
      if (!res.ok || data.error) {
        setDailyLogError(data.error || `Failed (${res.status})`)
        return
      }
      setDailyLogResult({ stop_count: data.stop_count!, action: data.action! })
    } catch (e) {
      setDailyLogError(e instanceof Error ? e.message : 'Failed to send to Daily Log')
    } finally {
      setSendingDailyLog(false)
    }
  }

  function recalculateETAs() {
    if (!optimizedVisits || optimizedVisits.length === 0) return
    const [hh, mm] = startTime.split(':').map(Number)
    let elapsedMin = (hh + mm / 60) * 60
    let prevMatrixIdx = 0  // depot is always index 0

    const recalculated = optimizedVisits.map((v, i) => {
      let driveMin: number
      let distKm: number

      if (durationMatrix) {
        // Real road time from cached matrix (seconds → minutes)
        driveMin = Math.round(durationMatrix[prevMatrixIdx][v.matrixIndex] / 60)
        // Haversine just for the km display
        const prev = i === 0 ? depotCoord! : { lat: optimizedVisits[i - 1].lat, lng: optimizedVisits[i - 1].lng }
        distKm = Math.round(haversineKm(prev, { lat: v.lat, lng: v.lng }) * 10) / 10
      } else {
        // Haversine fallback
        const prev = i === 0 ? depotCoord! : { lat: optimizedVisits[i - 1].lat, lng: optimizedVisits[i - 1].lng }
        distKm = Math.round(haversineKm(prev, { lat: v.lat, lng: v.lng }) * 10) / 10
        driveMin = Math.round((distKm / avgSpeedKmh) * 60)
      }

      elapsedMin += driveMin
      const eta = fmtTimeClient(elapsedMin)
      const startAtISO = date ? toISOLocalClient(date, elapsedMin) : null
      const endAtISO = date ? toISOLocalClient(date, elapsedMin + v.onSiteMinutes) : null
      elapsedMin += v.onSiteMinutes
      prevMatrixIdx = v.matrixIndex

      return { ...v, stopNumber: i + 1, driveMinutes: driveMin, distanceKm: distKm, eta, startAtISO, endAtISO }
    })

    setOptimizedVisits(recalculated)
    setIsManualOrder(false)
    setSendResults(null)
    setSendError(null)
  }

  async function generateRouteHtml(): Promise<string> {
    if (!optimizedVisits || optimizedVisits.length === 0) return ''
    const techName = selectedUserIds.length === 0
      ? 'Unknown Tech'
      : selectedUserIds.length === 1
        ? (users.find(u => u.id === selectedUserIds[0])?.name ?? 'Unknown Tech')
        : selectedUserIds
            .map(id => users.find(u => u.id === id)?.name)
            .filter(Boolean)
            .join(' + ')
    const dateFormatted = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    })
    // Return-to-depot leg
    let sheetReturnMin = 0
    let sheetReturnKm = 0
    if (depotCoord && optimizedVisits.length > 0) {
      const last = optimizedVisits[optimizedVisits.length - 1]
      if (durationMatrix) {
        sheetReturnMin = Math.round(durationMatrix[last.matrixIndex][0] / 60)
        sheetReturnKm = Math.round(haversineKm({ lat: last.lat, lng: last.lng }, depotCoord) * 10) / 10
      } else {
        sheetReturnKm = Math.round(haversineKm({ lat: last.lat, lng: last.lng }, depotCoord) * 10) / 10
        sheetReturnMin = Math.round((sheetReturnKm / avgSpeedKmh) * 60)
      }
    }
    const totalDriveMin = optimizedVisits.reduce((s, v) => s + v.driveMinutes, 0) + sheetReturnMin
    const totalMiles = ((optimizedVisits.reduce((s, v) => s + v.distanceKm, 0) + sheetReturnKm) / 1.609).toFixed(1)
    const totalRevenue = optimizedVisits.reduce((s, v) => s + v.totalPrice, 0)
    const driveHours = Math.floor(totalDriveMin / 60)
    const driveRemMin = totalDriveMin % 60
    const driveSummary = driveHours > 0
      ? `${driveHours} hr ${driveRemMin} min (${totalDriveMin} min)`
      : `${totalDriveMin} min`

    // ── Mapbox Static Image URL (used both on screen and in print) ──
    // We deliberately do NOT use Mapbox GL JS here because GL JS tile requests
    // get blocked by the public token's URL restrictions on certain origins,
    // while the Static Images API works everywhere the token is enabled.
    // For the path, we first try the Directions API (same as the preview map)
    // to get actual road geometry. Falls back to straight lines for routes
    // over 25 waypoints or when the API call fails.
    const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
    let staticMapUrl = ''
    if (mapboxToken && depotCoord) {
      const stopWaypoints = optimizedVisits.map(v => ({ lat: v.lat, lng: v.lng }))
      // Full loop: depot → stops → depot (matches preview map behaviour)
      const allWaypoints = [depotCoord, ...stopWaypoints, depotCoord]

      // Try to fetch the actual driving route from Mapbox Directions API
      let pathCoords: Array<{ lat: number; lng: number }> = allWaypoints
      if (allWaypoints.length >= 2 && allWaypoints.length <= 25) {
        try {
          const coordStr = allWaypoints.map(p => `${p.lng},${p.lat}`).join(';')
          const dirRes = await fetch(
            `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}` +
            `?geometries=geojson&overview=simplified&access_token=${mapboxToken}`
          )
          if (dirRes.ok) {
            const dirData = await dirRes.json() as {
              code: string
              routes?: Array<{ geometry: { coordinates: [number, number][] } }>
            }
            if (dirData.code === 'Ok' && dirData.routes?.[0]?.geometry?.coordinates?.length) {
              pathCoords = dirData.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng }))
            }
          }
        } catch {
          // fall back to straight-line waypoints
        }
      }

      const polyline = encodePolyline5(pathCoords)
      const pathOverlay = `path-3+1f77b4-0.85(${encodeURIComponent(polyline)})`
      const depotMarker = `pin-s-d+16a34a(${depotCoord.lng.toFixed(6)},${depotCoord.lat.toFixed(6)})`
      const stopMarkers = optimizedVisits.map((v, i) => {
        const label = i < 9 ? String(i + 1) : String.fromCharCode(97 + (i - 9))
        return `pin-s-${label}+c0392b(${v.lng.toFixed(6)},${v.lat.toFixed(6)})`
      })
      const overlays = [pathOverlay, depotMarker, ...stopMarkers].join(',')
      staticMapUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays}/auto/1200x700@2x?padding=40&access_token=${mapboxToken}`
    }

    const mapHtml = staticMapUrl
      ? `<img class="route-map-img" src="${staticMapUrl}" alt="Route map">`
      : `<div class="map-unavailable">Configure depot in Settings to enable map</div>`

    // Page 1: summary stop list
    const returnRow = sheetReturnMin > 0
      ? `<tr>
          <td class="sl-num"><span class="sl-circle" style="background:#374151;font-size:14px">↩</span></td>
          <td class="sl-name" style="color:#6b7280">Return to depot</td>
          <td class="sl-addr" style="color:#9ca3af">${(sheetReturnKm / 1.609).toFixed(1)} mi</td>
          <td class="sl-eta" style="color:#6b7280">${sheetReturnMin} min</td>
        </tr>`
      : ''
    const summaryRows = optimizedVisits.map(v => `
      <tr>
        <td class="sl-num"><span class="sl-circle">${v.stopNumber}</span></td>
        <td class="sl-name">${v.clientName}</td>
        <td class="sl-addr">${v.addressString}</td>
        <td class="sl-eta">${v.eta ?? ''}</td>
      </tr>`).join('') + returnRow

    // Pages 2+: detailed stop cards
    const cardHtml = optimizedVisits.map(v => {
      const instructionsHtml = v.instructions
        ? `<div class="instr-box">${v.instructions}</div>`
        : ''

      const liRows = v.lineItems.length > 0
        ? v.lineItems.map(li => {
            const unitPriceStr = li.unitPrice > 0 ? `$${li.unitPrice.toFixed(li.unitPrice < 1 ? 3 : 2)}` : '—'
            const qtyStr = li.qty !== 1 ? li.qty.toLocaleString() : '1'
            return `<tr>
              <td class="li-name">${li.name}</td>
              <td class="li-qty">${qtyStr}</td>
              <td class="li-rate">${unitPriceStr}</td>
              <td class="li-amt">$${li.totalPrice.toFixed(2)}</td>
            </tr>`
          }).join('')
        : `<tr><td class="li-name" colspan="3">${v.services || '—'}</td><td class="li-amt">$${v.totalPrice.toFixed(2)}</td></tr>`

      return `
      <div class="card">
        <div class="card-header">
          <span class="card-circle">${v.stopNumber}</span>
          <div class="card-title-block">
            <div class="card-client">${v.clientName}</div>
            <div class="card-jobtitle">${v.jobTitle}</div>
          </div>
          ${v.eta ? `<div class="card-appt">${v.eta}</div>` : ''}
        </div>
        <div class="card-meta">
          <div class="card-meta-col">
            <div class="meta-label">ADDRESS</div>
            <div class="meta-val">${v.addressString}</div>
          </div>
          <div class="card-meta-col">
            <div class="meta-label">PHONE</div>
            <div class="meta-val">${v.phone ?? '—'}</div>
          </div>
          <div class="card-meta-col card-meta-col--narrow">
            <div class="meta-label">DRIVE</div>
            <div class="meta-val">${v.driveMinutes} min</div>
          </div>
          <div class="card-meta-col card-meta-col--narrow">
            <div class="meta-label">ON-SITE</div>
            <div class="meta-val">${v.onSiteMinutes} min</div>
          </div>
        </div>
        ${instructionsHtml}
        <table class="li-table">
          <thead>
            <tr>
              <th class="li-name">SERVICE / LINE ITEM</th>
              <th class="li-qty">QTY</th>
              <th class="li-rate">RATE</th>
              <th class="li-amt">AMOUNT</th>
            </tr>
          </thead>
          <tbody>${liRows}</tbody>
          <tfoot>
            <tr class="li-total">
              <td colspan="3">JOB TOTAL</td>
              <td>$${v.totalPrice.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
        <div class="field-notes-label">FIELD NOTES</div>
        <div class="field-lines"></div>
      </div>`
    }).join('')

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Route Sheet &mdash; ${techName} &mdash; ${date}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 13px; }
    .print-btn { background: #f97316; color: #fff; border: none; padding: 10px 22px;
      border-radius: 8px; font-size: 14px; cursor: pointer; margin: 16px 24px; display: block; }

    /* Static route map — used on screen and in print (no GL JS, no tile API).
       object-fit:contain shows the full Mapbox image (with letterboxing if the
       container aspect doesn't match) so users always see the entire route +
       basemap, never a cropped slice. */
    .route-map-img { display: block; width: 100%; height: 100%; object-fit: contain; background: #f3f4f6; }

    @media print {
      .print-btn { display: none !important; }

      /* Page 1 landscape (map + summary), remaining pages portrait */
      @page { size: letter portrait; margin: 0.5in; }
      @page landscape-page { size: letter landscape; margin: 0.5in; }
      .summary { page: landscape-page; }
      .cards { page: portrait; }

      /* Allow stop list to expand beyond fixed height when printing */
      .summary-body { height: auto; }
      .stoplist-panel { overflow: visible; }
    }

    /* ── Page 1: Summary ── */
    .summary { page-break-after: always; }
    .summary-header { background: #0f1f3d; color: #fff; padding: 14px 18px;
      display: flex; justify-content: space-between; align-items: baseline; }
    .summary-header h1 { font-size: 18px; font-weight: bold; }
    .summary-header .sh-meta { font-size: 12px; color: #9ca3af; }
    .summary-subhead { background: #e5e7eb; padding: 6px 18px; font-size: 11px;
      color: #374151; text-align: right; }
    .summary-body { display: flex; height: 460px; border-top: 1px solid #d1d5db; }
    .map-panel { flex: 0 0 60%; border-right: 1px solid #d1d5db; overflow: hidden;
      position: relative; }
    .map-unavailable { width: 100%; height: 100%; display: flex; align-items: center;
      justify-content: center; font-size: 12px; color: #9ca3af;
      background: #f9fafb; padding: 24px; text-align: center; }
    .stoplist-panel { flex: 1; overflow: hidden; }
    .depot-row { background: #f9fafb; padding: 8px 14px; font-size: 12px;
      color: #16a34a; font-weight: bold; border-bottom: 1px solid #d1d5db; }
    .stop-list { width: 100%; border-collapse: collapse; }
    .stop-list tr { border-bottom: 1px solid #e5e7eb; }
    .stop-list tr:nth-child(even) { background: #f9fafb; }
    .sl-num { width: 40px; padding: 7px 4px 7px 12px; }
    .sl-circle { display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border-radius: 50%; background: #c0392b;
      color: #fff; font-size: 11px; font-weight: bold; }
    .sl-name { font-weight: bold; font-size: 12px; padding: 7px 4px; }
    .sl-addr { font-size: 11px; color: #555; padding: 7px 4px; }
    .sl-eta { font-size: 11px; color: #ea580c; padding: 7px 12px 7px 4px;
      white-space: nowrap; }

    /* ── Stop cards ── */
    .cards { padding: 0 24px 24px; }
    .card { margin-bottom: 28px; page-break-inside: avoid; border: 1px solid #d1d5db; }
    .card-header { background: #0f1f3d; color: #fff; padding: 10px 14px;
      display: flex; align-items: center; gap: 12px; }
    .card-circle { display: inline-flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 50%; background: #c0392b;
      color: #fff; font-size: 15px; font-weight: bold; flex-shrink: 0; }
    .card-title-block { flex: 1; min-width: 0; }
    .card-client { font-size: 15px; font-weight: bold; line-height: 1.2; }
    .card-jobtitle { font-size: 15px; color: #e5e7eb; margin-top: 3px; font-weight: 600; letter-spacing: 0.02em; }
    .card-appt { font-size: 13px; color: #fbbf24; font-weight: bold;
      flex-shrink: 0; white-space: nowrap; }
    .card-meta { display: flex; gap: 0; border-bottom: 1px solid #e5e7eb; }
    .card-meta-col { flex: 1; padding: 8px 14px; }
    .card-meta-col + .card-meta-col { border-left: 1px solid #e5e7eb; }
    .card-meta-col--narrow { flex: 0 0 80px; }
    .meta-label { font-size: 10px; color: #9ca3af; font-weight: bold;
      letter-spacing: 0.05em; margin-bottom: 2px; }
    .meta-val { font-size: 12px; }
    .instr-box { background: #f0fdf4; border: 1px solid #86efac; color: #166534;
      padding: 7px 14px; font-size: 12px; border-left: 3px solid #16a34a; }
    .li-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .li-table thead tr { background: #0f1f3d; color: #fff; }
    .li-table thead th { padding: 6px 10px; text-align: left; font-size: 10px;
      font-weight: bold; letter-spacing: 0.04em; }
    .li-table tbody tr { border-bottom: 1px solid #e5e7eb; }
    .li-table tbody tr:nth-child(even) { background: #f9fafb; }
    .li-table td { padding: 5px 10px; }
    .li-qty, .li-rate, .li-amt { width: 70px; text-align: right; white-space: nowrap; }
    .li-name { text-align: left; }
    .li-total { font-weight: bold; background: #1e3a5f !important;
      color: #fff; border-top: 2px solid #0f1f3d; }
    .li-total td { padding: 6px 10px; text-align: right; }
    .li-total td:first-child { text-align: left; font-size: 11px;
      letter-spacing: 0.04em; }
    .field-notes-label { padding: 6px 14px 2px; font-size: 10px; color: #9ca3af;
      font-weight: bold; letter-spacing: 0.05em; }
    .field-lines { height: 48px; border-top: 1px solid #e5e7eb;
      background: repeating-linear-gradient(
        to bottom, transparent, transparent 23px, #e5e7eb 23px, #e5e7eb 24px
      ); margin: 0 14px 10px; }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">&#x1F5A8;&nbsp; Print / Save as PDF</button>

  <!-- Page 1: Summary -->
  <div class="summary">
    <div class="summary-header">
      <h1>${techName} &mdash; Route Sheet</h1>
      <span class="sh-meta">${dateFormatted}</span>
    </div>
    <div class="summary-subhead">
      ${driveSummary} &nbsp;|&nbsp; ${totalMiles} miles &nbsp;|&nbsp; ${optimizedVisits.length} Stops
      ${totalRevenue > 0 ? ` &nbsp;|&nbsp; $${totalRevenue.toFixed(2)}` : ''}
    </div>
    <div class="summary-body">
      <div class="map-panel">${mapHtml}</div>
      <div class="stoplist-panel">
        <div class="depot-row">&#x25A0; DEPOT</div>
        <table class="stop-list">
          <tbody>${summaryRows}</tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Pages 2+: Stop cards -->
  <div class="cards">${cardHtml}</div>
</body>
</html>`

    return html
  }

  async function printRouteSheet() {
    const html = await generateRouteHtml()
    if (!html) return
    // Hand off via localStorage to /hub/routing/print, which replaces its own
    // document with the HTML. The blob: URL approach used previously failed to
    // load Mapbox tiles because the public Mapbox token's URL restrictions
    // don't match the blob: origin — pins and the route line still drew
    // (they're DOM elements) but the basemap stayed blank. Loading the sheet
    // from a real lynxedo.com route fixes the referer check.
    try {
      const key = `hub_print_sheet_${Math.random().toString(36).slice(2)}_${Date.now()}`
      localStorage.setItem(key, JSON.stringify({ html, t: Date.now() }))
      window.open(`/hub/routing/print?k=${encodeURIComponent(key)}`, '_blank')
    } catch {
      // localStorage full or disabled — fall back to the legacy blob path so
      // the user at least gets a sheet (just without the basemap).
      const blob = new Blob([html], { type: 'text/html' })
      const blobUrl = URL.createObjectURL(blob)
      window.open(blobUrl, '_blank')
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000)
    }
  }

  async function sendToDailyLogV1() {
    if (!optimizedVisits || optimizedVisits.length === 0) return

    if (selectedUserIds.length > 1 && reassignUserId === '__keep__') {
      setDailyLogV1Error('Multiple techs were loaded. Pick a target tech in "Reassign to" before sending to Daily Log.')
      return
    }

    const techJobberUserId = reassignUserId !== '__keep__'
      ? reassignUserId
      : selectedUserIds[0]
    const techJobberUserName = users.find(u => u.id === techJobberUserId)?.name ?? ''
    if (!techJobberUserName) {
      setDailyLogV1Error('Could not resolve the target tech\'s name. Reload the page and try again.')
      return
    }

    setSendingDailyLogV1(true)
    setDailyLogV1Error(null)
    setDailyLogV1Result(null)

    const html = await generateRouteHtml()
    if (!html) {
      setDailyLogV1Error('Failed to generate route sheet HTML.')
      setSendingDailyLogV1(false)
      return
    }

    const routeName = `${techJobberUserName} - ${date}.html`

    try {
      const res = await fetch('/api/hub/daily-log/from-route-v1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_date: date,
          tech_jobber_user_id: techJobberUserId,
          tech_jobber_user_name: techJobberUserName,
          route_html: html,
          route_name: routeName,
        }),
      })
      const data = await res.json() as {
        entry_id?: string
        action?: 'created' | 'updated'
        error?: string
      }
      if (!res.ok || data.error) {
        setDailyLogV1Error(data.error || `Failed (${res.status})`)
        return
      }
      setDailyLogV1Result({ action: data.action! })
    } catch (e) {
      setDailyLogV1Error(e instanceof Error ? e.message : 'Failed to send to Daily Log')
    } finally {
      setSendingDailyLogV1(false)
    }
  }

  const displayVisits = optimizedVisits ?? visits
  const skippedVisits = (visits && optimizedVisits)
    ? visits.filter(v => !selectedIds.has(v.id) && !sentIds.has(v.id))
    : []

  // Return-to-depot leg (last stop → depot) — shown in list and added to totals
  let returnDriveMin = 0
  let returnDistKm = 0
  if (optimizedVisits && optimizedVisits.length > 0 && depotCoord) {
    const last = optimizedVisits[optimizedVisits.length - 1]
    if (durationMatrix) {
      returnDriveMin = Math.round(durationMatrix[last.matrixIndex][0] / 60)
      returnDistKm = Math.round(haversineKm({ lat: last.lat, lng: last.lng }, depotCoord) * 10) / 10
    } else {
      returnDistKm = Math.round(haversineKm({ lat: last.lat, lng: last.lng }, depotCoord) * 10) / 10
      returnDriveMin = Math.round((returnDistKm / avgSpeedKmh) * 60)
    }
  }

  const sendResultMap = new Map(sendResults?.map(r => [r.visitId, r]) ?? [])
  const sendSuccessCount = sendResults?.filter(r => r.success).length ?? 0
  const sendAllOk = sendResults !== null && sendResults.every(r => r.success)
  const selectedCount = visits ? (visits.filter(v => selectedIds.has(v.id) && !sentIds.has(v.id))).length : 0

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h3 className="font-semibold text-lg mb-4">Quick Route</h3>
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Date picker */}
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); setOptimizedVisits(null); setSendResults(null) }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          {/* Tech multi-select */}
          <div className="flex-1 relative" ref={techPickerRef}>
            <label className="block text-xs text-gray-400 mb-1">Team Member(s)</label>
            {usersLoading ? (
              <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-500">
                Loading users…
              </div>
            ) : usersError ? (
              <div className="text-red-400 text-sm py-2">Error: {usersError}</div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setTechPickerOpen(v => !v)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 text-left flex items-center justify-between gap-2"
                >
                  <span className="truncate">{techLabel}</span>
                  <span className="text-gray-500 text-xs">{techPickerOpen ? '▲' : '▼'}</span>
                </button>
                {techPickerOpen && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-h-80 overflow-y-auto">
                    <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-800 text-xs">
                      <button
                        type="button"
                        onClick={() => setSelectedUserIds(users.map(u => u.id))}
                        className="text-orange-400 hover:text-orange-300"
                      >
                        Select all
                      </button>
                      <span className="text-gray-700">·</span>
                      <button
                        type="button"
                        onClick={() => setSelectedUserIds([])}
                        className="text-orange-400 hover:text-orange-300"
                      >
                        Clear
                      </button>
                      <span className="ml-auto text-gray-500">
                        {selectedUserIds.length} / {users.length}
                      </span>
                    </div>
                    {users.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-gray-500">
                        No team members available. Set the allowlist in <em>Admin → Routing</em>.
                      </div>
                    ) : users.map(u => {
                      const checked = selectedUserIds.includes(u.id)
                      return (
                        <label
                          key={u.id}
                          className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-800"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTech(u.id)}
                            className="w-4 h-4 accent-orange-500"
                          />
                          <span className="text-sm text-white">{u.name}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Start time */}
          <div className="w-32">
            <label className="block text-xs text-gray-400 mb-1">Start Time</label>
            <input
              type="time"
              value={startTime}
              onChange={e => { setStartTime(e.target.value); setOptimizedVisits(null); setSendResults(null) }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          {/* Duration method */}
          <div className="w-36">
            <label className="block text-xs text-gray-400 mb-1">Duration</label>
            <select
              value={durationMethod}
              onChange={e => setDurationMethod(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            >
              <option value="default">Default</option>
              <option value="formula">Formula</option>
            </select>
          </div>

          {/* Load button */}
          <div className="flex items-end">
            <button
              onClick={loadVisits}
              disabled={visitsLoading || selectedUserIds.length === 0}
              className="w-full sm:w-auto px-5 py-2 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {visitsLoading ? 'Loading…' : 'Load Visits'}
            </button>
          </div>
        </div>
      </div>

      {/* Errors */}
      {visitsError && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
          {visitsError}
        </div>
      )}
      {optimizeError && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
          Optimization failed: {optimizeError}
        </div>
      )}
      {geocodeFailed.length > 0 && visits && (
        <div className="bg-yellow-900/40 border border-yellow-700 text-yellow-300 rounded-lg px-4 py-3 text-sm">
          Could not geocode {geocodeFailed.length} address{geocodeFailed.length !== 1 ? 'es' : ''}
          {' '}({geocodeFailed.map(i => (optimizedVisits ?? visits ?? [])[i]?.clientName).join(', ')}) — those stops were excluded from optimization.
        </div>
      )}
      {fallbackStops.length > 0 && (
        <div className="bg-yellow-900/40 border border-yellow-700 text-yellow-300 rounded-lg px-4 py-3 text-sm">
          ⚠️ Duration fallback used for: {fallbackStops.join(', ')} — no matching line items found. Check Duration Rules in Settings.
        </div>
      )}

      {/* Main content: map LEFT + visit list RIGHT */}
      {displayVisits !== null && (
        <div className="flex flex-col lg:flex-row gap-4 items-start">

          {/* ── RIGHT: Map panel (sticky on large screens) ── */}
          <div className="w-full lg:w-3/5 lg:sticky lg:top-6 lg:order-last">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                <h3 className="font-semibold text-sm">
                  {optimizedVisits ? 'Route Preview' : 'Stop Locations'}
                </h3>
                <span className="text-xs text-gray-500">
                  {coordsLoading && !optimizedVisits ? 'Locating pins…' : ''}
                  {optimizedVisits ? 'Drag, zoom, and the path follows actual roads' : ''}
                </span>
              </div>
              {previewPins.length > 0 || depotCoord ? (
                <RoutePreviewMap
                  depotCoord={depotCoord}
                  pins={previewPins}
                  drawDrivePath={!!optimizedVisits && optimizedVisits.length > 0}
                />
              ) : (
                <div className="px-4 py-12 text-gray-600 text-sm text-center">
                  {!process.env.NEXT_PUBLIC_MAPBOX_TOKEN
                    ? 'Map unavailable — configure Mapbox token'
                    : visitCoords.length > 0 && visitCoords.every(c => c === null)
                    ? 'Could not locate addresses on map'
                    : 'Locating stops…'}
                </div>
              )}
              {/* Legend — show before optimization when we have at least some coords */}
              {visits && !optimizedVisits && visitCoords.some(c => c !== null) && (
                <div className="px-4 py-2 border-t border-gray-800 flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-full bg-orange-500"></span> Selected
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-full bg-gray-600"></span> Skipped
                  </span>
                  {sentIds.size > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-3 h-3 rounded-full bg-gray-500"></span> Sent
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── LEFT: Visit list ── */}
          <div className="w-full lg:w-2/5">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold">
                    {displayVisits.length === 0
                      ? 'No visits found'
                      : `${displayVisits.length} stop${displayVisits.length !== 1 ? 's' : ''}`}
                  </h3>
                  {optimizedVisits && (
                    <span className="text-xs bg-green-900/50 text-green-400 border border-green-800 px-2 py-0.5 rounded-full">
                      Optimized
                    </span>
                  )}
                  {visits && !optimizedVisits && selectedCount > 0 && selectedCount < (visits.length - sentIds.size) && (
                    <span className="text-xs text-gray-500">{selectedCount} selected</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {displayVisits.length > 0 && (
                    <span className="text-xs text-gray-500">
                      ${displayVisits.reduce((s, v) => s + v.totalPrice, 0).toFixed(2)} total
                    </span>
                  )}
                  {visits && !optimizedVisits && (lockedFirstId || lockedLastId) && (
                    <span className="text-xs text-gray-400">
                      {[lockedFirstId && '📌 1st', lockedLastId && '📌 Last'].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {visits && !optimizedVisits && visits.length > 0 && (
                    <button
                      onClick={() => {
                        const unsent = visits.filter(v => !sentIds.has(v.id)).map(v => v.id)
                        const allSelected = unsent.every(id => selectedIds.has(id))
                        setSelectedIds(allSelected ? new Set() : new Set(unsent))
                      }}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-xs font-medium transition-colors"
                    >
                      {visits.filter(v => !sentIds.has(v.id)).every(v => selectedIds.has(v.id)) ? 'Deselect All' : 'Select All'}
                    </button>
                  )}
                  {visits && selectedCount > 1 && !optimizedVisits && (
                    <button
                      onClick={optimizeRoute}
                      disabled={optimizing}
                      className="px-4 py-1.5 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-xs font-medium transition-colors"
                    >
                      {optimizing ? 'Optimizing…' : `⚡ Optimize ${selectedCount}`}
                    </button>
                  )}
                  {optimizedVisits && usingMatrix !== null && (
                    <span
                      title={usingMatrix ? 'Drive times use real road routes (Mapbox Matrix API)' : 'Drive times use straight-line distance — Matrix API unavailable'}
                      className={`text-xs px-2 py-1 rounded-full font-medium ${usingMatrix ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}
                    >
                      {usingMatrix ? '🗺 Road times' : '📐 Straight-line'}
                    </span>
                  )}
                  {optimizedVisits && isManualOrder && (
                    <button
                      onClick={recalculateETAs}
                      className="px-4 py-1.5 bg-orange-500 hover:bg-orange-400 text-white rounded-lg text-xs font-medium transition-colors animate-pulse"
                    >
                      ⚡ Recalculate
                    </button>
                  )}
                  {optimizedVisits && (
                    <button
                      onClick={() => {
                        setOptimizedVisits(null)
                        setGeocodeFailed([])
                        setUsingMatrix(null)
                        setDurationMatrix(null)
                        setIsManualOrder(false)
                        setSendResults(null)
                        setSendError(null)
                      }}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-xs font-medium transition-colors"
                    >
                      Reset Order
                    </button>
                  )}
                  {optimizedVisits && optimizedVisits.length > 0 && (
                    <button
                      onClick={printRouteSheet}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-xs font-medium transition-colors"
                    >
                      📄 Route Sheet
                    </button>
                  )}
                </div>
              </div>

              {displayVisits.length === 0 ? (
                <p className="px-6 py-8 text-gray-500 text-sm text-center">
                  No visits scheduled for this tech on this date.
                </p>
              ) : (
                <ul className="divide-y divide-gray-800">
                  {displayVisits.map((v, idx) => {
                    const optimized = v as OptimizedVisit
                    const hasEta = 'eta' in v && optimized.eta
                    const result = sendResultMap.get(v.id)
                    const isDragging = draggingIdx === idx
                    const isDragTarget = dragOverIdx === idx && draggingIdx !== idx
                    const isSent = sentIds.has(v.id)
                    const isChecked = selectedIds.has(v.id) && !isSent
                    return (
                      <li
                        key={v.id}
                        draggable={!!optimizedVisits}
                        onDragStart={optimizedVisits ? () => setDraggingIdx(idx) : undefined}
                        onDragOver={optimizedVisits ? (e) => { e.preventDefault(); setDragOverIdx(idx) } : undefined}
                        onDrop={optimizedVisits ? (e) => {
                          e.preventDefault()
                          if (draggingIdx === null || draggingIdx === idx) { setDragOverIdx(null); return }
                          const newList = [...optimizedVisits]
                          const [moved] = newList.splice(draggingIdx, 1)
                          newList.splice(idx, 0, moved)
                          setOptimizedVisits(newList.map((s, i) => ({ ...s, stopNumber: i + 1 })))
                          setIsManualOrder(true)
                          setDraggingIdx(null)
                          setDragOverIdx(null)
                        } : undefined}
                        onDragEnd={optimizedVisits ? () => { setDraggingIdx(null); setDragOverIdx(null) } : undefined}
                        className={[
                          'px-6 py-4 flex gap-3 items-start transition-opacity',
                          isDragging ? 'opacity-30' : isSent ? 'opacity-40' : 'opacity-100',
                          isDragTarget ? 'border-t-2 border-orange-500' : '',
                          optimizedVisits ? 'cursor-grab active:cursor-grabbing' : '',
                        ].join(' ')}
                      >
                        {/* Checkbox — shown before optimization only */}
                        {!optimizedVisits && (
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={isSent}
                            onChange={e => {
                              setSelectedIds(prev => {
                                const next = new Set(prev)
                                if (e.target.checked) next.add(v.id)
                                else next.delete(v.id)
                                return next
                              })
                            }}
                            className="mt-1.5 w-4 h-4 shrink-0 rounded border-gray-600 accent-orange-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        )}
                        {optimizedVisits && (
                          <span className="text-gray-600 shrink-0 mt-1 select-none text-lg leading-none" title="Drag to reorder">⠿</span>
                        )}
                        <span className="text-2xl font-bold text-gray-600 w-8 shrink-0 text-right mt-0.5">
                          {v.stopNumber}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`font-medium truncate ${isSent ? 'text-gray-500 line-through' : 'text-white'}`}>{v.clientName}</p>
                            {v.type === 'assessment' && (
                              <span className="shrink-0 text-xs bg-blue-900/50 text-blue-300 border border-blue-700 px-1.5 py-0.5 rounded">
                                📋 Assessment
                              </span>
                            )}
                            {selectedUserIds.length > 1 && v.techId && (
                              <span className="shrink-0 text-xs bg-purple-900/40 text-purple-300 border border-purple-800 px-1.5 py-0.5 rounded">
                                {users.find(u => u.id === v.techId)?.name?.split(' ')[0] ?? 'tech'}
                              </span>
                            )}
                            {isSent && (
                              <span className="shrink-0 text-xs bg-green-900/30 text-green-600 border border-green-900 px-1.5 py-0.5 rounded">
                                ✓ Sent
                              </span>
                            )}
                          </div>
                          {v.jobTitle && (
                            <p className="text-sm text-orange-300 truncate">{v.jobTitle}</p>
                          )}
                          <p className="text-sm text-gray-400 truncate">{v.addressString}</p>
                          {v.services && (
                            <p className="text-xs text-gray-500 mt-0.5 truncate">{v.services}</p>
                          )}
                          {hasEta && (
                            <p className="text-xs text-orange-400 mt-1">
                              ⏱ {optimized.driveMinutes} min drive · {optimized.onSiteMinutes} min on-site · arrive ~{optimized.eta}
                            </p>
                          )}
                          {result && !result.success && (
                            <p className="text-xs text-red-400 mt-1">✗ {result.error}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {v.totalPrice > 0 && (
                            <span className="text-sm text-gray-400">${v.totalPrice.toFixed(2)}</span>
                          )}
                          {result?.success && <span className="text-green-400 text-sm">✓</span>}
                          {result && !result.success && <span className="text-red-400 text-sm">✗</span>}
                          {visits && !optimizedVisits && !isSent && (
                            <>
                              <button
                                onClick={() => setLockedFirstId(lockedFirstId === v.id ? null : v.id)}
                                title="Pin as first stop"
                                className={`text-xs px-2 py-0.5 rounded font-medium transition-colors ${
                                  lockedFirstId === v.id
                                    ? 'bg-green-600 text-white'
                                    : 'bg-gray-700 text-gray-400 hover:text-gray-200'
                                }`}
                              >
                                1st
                              </button>
                              <button
                                onClick={() => setLockedLastId(lockedLastId === v.id ? null : v.id)}
                                title="Pin as last stop"
                                className={`text-xs px-2 py-0.5 rounded font-medium transition-colors ${
                                  lockedLastId === v.id
                                    ? 'bg-orange-600 text-white'
                                    : 'bg-gray-700 text-gray-400 hover:text-gray-200'
                                }`}
                              >
                                Last
                              </button>
                            </>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}

              {/* Return to depot row */}
              {optimizedVisits && optimizedVisits.length > 0 && depotCoord && returnDriveMin > 0 && (
                <div className="px-6 py-3 flex gap-3 items-center border-t border-gray-800 bg-gray-950/40">
                  <span className="text-gray-600 w-8 shrink-0 text-right text-base">↩</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-500">Return to depot</p>
                  </div>
                  <span className="text-xs text-gray-600">{returnDriveMin} min &nbsp;·&nbsp; {(returnDistKm / 1.609).toFixed(1)} mi</span>
                </div>
              )}

              {/* Skipped stops — deselected before optimize, shown dimmed at bottom */}
              {skippedVisits.length > 0 && (
                <>
                  <div className="px-6 py-2 border-t border-gray-800 bg-gray-950/60 flex items-center gap-2">
                    <span className="text-xs text-gray-600 font-medium uppercase tracking-wider">
                      Not on this route — {skippedVisits.length} stop{skippedVisits.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <ul className="divide-y divide-gray-800/50">
                    {skippedVisits.map(v => (
                      <li key={v.id} className="px-6 py-3 flex gap-3 items-start opacity-40">
                        <span className="text-gray-700 w-8 shrink-0 text-right mt-0.5 text-lg">—</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-400 truncate">{v.clientName}</p>
                          {v.jobTitle && <p className="text-sm text-orange-400/60 truncate">{v.jobTitle}</p>}
                          <p className="text-sm text-gray-500 truncate">{v.addressString}</p>
                          {v.services && <p className="text-xs text-gray-600 mt-0.5 truncate">{v.services}</p>}
                        </div>
                        {v.totalPrice > 0 && (
                          <span className="text-sm text-gray-600 shrink-0">${v.totalPrice.toFixed(2)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Send route panel */}
      {optimizedVisits && optimizedVisits.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h3 className="font-semibold text-lg mb-1">Send route</h3>
          <p className="text-sm text-gray-400 mb-4">
            Push the optimized route to Jobber, the Daily Log, or both.
          </p>

          {sendAllOk && (
            <div className="mb-4 bg-green-900/40 border border-green-700 text-green-300 rounded-lg px-4 py-3 text-sm">
              ✓ {sendSuccessCount}/{sendResults!.length} {sendMode === 'order' ? 'visits reordered in Jobber' : 'visits updated in Jobber'} — click Reset Order to select your next batch
            </div>
          )}
          {sendResults && !sendAllOk && (
            <div className="mb-4 bg-yellow-900/40 border border-yellow-700 text-yellow-300 rounded-lg px-4 py-3 text-sm">
              {sendSuccessCount}/{sendResults.length} {sendMode === 'order' ? 'reordered' : 'updated'} — {sendResults.length - sendSuccessCount} failed (see stops above)
            </div>
          )}
          {sendError && (
            <div className="mb-4 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
              {sendError}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1">
              Reassign to{selectedUserIds.length > 1 && <span className="text-orange-400"> (required — multiple techs loaded)</span>}
            </label>
            <select
              value={reassignUserId}
              onChange={e => setReassignUserId(e.target.value)}
              disabled={sending}
              className="w-full sm:w-72 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 disabled:opacity-50"
            >
              <option value="__keep__" disabled={selectedUserIds.length > 1}>
                {selectedUserIds.length > 1 ? '— choose a tech —' : 'Keep current assignment'}
              </option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            {selectedUserIds.length === 1 && (
              <p className="text-xs text-gray-500 mt-1">
                Applies to Send Order Only, Send with Times, and Send to Daily Log.
              </p>
            )}
          </div>

          {dailyLogResult && (
            <div className="mb-4 bg-sky-900/40 border border-sky-700 text-sky-300 rounded-lg px-4 py-3 text-sm">
              ✓ Daily Log {dailyLogResult.action} with {dailyLogResult.stop_count} stops — open Daily Log v2 to view
            </div>
          )}
          {dailyLogError && (
            <div className="mb-4 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
              {dailyLogError}
            </div>
          )}
          {dailyLogV1Result && (
            <div className="mb-4 bg-indigo-900/40 border border-indigo-700 text-indigo-300 rounded-lg px-4 py-3 text-sm">
              ✓ Daily Log (v1) entry {dailyLogV1Result.action} with route sheet attached — open Daily Log to view
            </div>
          )}
          {dailyLogV1Error && (
            <div className="mb-4 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
              {dailyLogV1Error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <button
              onClick={sendOrderOnly}
              disabled={sending}
              title="Sets the stop order in Jobber without assigning appointment times — visits stay as anytime."
              className="px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors text-left"
            >
              <div className="font-semibold">
                {sending && sendMode === 'order' ? 'Sending Order…' : 'Send Order Only →'}
              </div>
              <div className="text-xs font-normal opacity-90 mt-0.5">
                Keep visits as anytime, set the stop order
              </div>
            </button>

            <button
              onClick={sendToJobber}
              disabled={sending}
              title="Sets appointment times on each visit, converting anytime visits to scheduled."
              className="px-4 py-3 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors text-left"
            >
              <div className="font-semibold">
                {sending && sendMode === 'times' ? 'Sending Times…' : 'Send with Times →'}
              </div>
              <div className="text-xs font-normal opacity-90 mt-0.5">
                Convert to scheduled visits with appointment times
              </div>
            </button>


            <button
              onClick={sendToDailyLog}
              disabled={sendingDailyLog}
              title="Populate the Daily Log v2 with the optimized stops for the target tech. Independent of Jobber — won't change visits in Jobber."
              className="px-4 py-3 bg-sky-600 hover:bg-sky-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors text-left"
            >
              <div className="font-semibold">
                {sendingDailyLog ? 'Sending…' : 'Send to Daily Log →'}
              </div>
              <div className="text-xs font-normal opacity-90 mt-0.5">
                Queue stops for the tech in Daily Log v2
              </div>
            </button>

            <button
              onClick={sendToDailyLogV1}
              disabled={sendingDailyLogV1}
              title="Create a Daily Log (v1) entry for the tech and attach the route sheet automatically."
              className="px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors text-left"
            >
              <div className="font-semibold">
                {sendingDailyLogV1 ? 'Sending…' : 'Send to Daily Log (v1) →'}
              </div>
              <div className="text-xs font-normal opacity-90 mt-0.5">
                Create entry + attach route sheet for the tech
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
