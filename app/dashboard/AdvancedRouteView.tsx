'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import AdvancedRouteMap, { type AdvPin } from '@/components/AdvancedRouteMap'

interface JobberUser { id: string; name: string }

interface LineItem { name: string; qty: number; unitPrice: number; totalPrice: number }

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
  // Decorated client-side during the multi-day pull:
  techId: string   // originating Jobber user
  dayDate: string  // the YYYY-MM-DD this visit was pulled for
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
  matrixIndex: number
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

interface AdvancedRouteViewProps {
  users: JobberUser[]
  usersLoading: boolean
  usersError: string | null
}

function todayLocal(): string {
  return new Date().toISOString().split('T')[0]
}

// Inclusive list of YYYY-MM-DD between start and end. Parsed at noon so the
// UTC conversion in toISOString never rolls the calendar day. Capped at 31.
function enumerateDays(start: string, end: string): string[] {
  const out: string[] = []
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return out
  const cur = new Date(s)
  while (cur <= e && out.length < 31) {
    out.push(cur.toISOString().split('T')[0])
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

// Pin label for route position (0-based): 1..9 then a, b, c…
function labelFor(pos: number): string {
  return pos < 9 ? String(pos + 1) : String.fromCharCode(97 + (pos - 9))
}

function dayHeading(day: string): string {
  return new Date(day + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  })
}

function stopTime(startAt: string | null): string {
  if (!startAt) return 'Anytime'
  const d = new Date(startAt)
  if (isNaN(d.getTime())) return 'Anytime'
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function AdvancedRouteView({ users, usersLoading, usersError }: AdvancedRouteViewProps) {
  const [startDate, setStartDate] = useState(todayLocal())
  const [endDate, setEndDate] = useState(todayLocal())
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [techPickerOpen, setTechPickerOpen] = useState(false)
  const techPickerRef = useRef<HTMLDivElement>(null)
  const [startTime, setStartTime] = useState('08:00')
  const [durationMethod, setDurationMethod] = useState<string>('default')

  const [visits, setVisits] = useState<Visit[] | null>(null)
  const [visitsLoading, setVisitsLoading] = useState(false)
  const [visitsError, setVisitsError] = useState<string | null>(null)

  const [coordsById, setCoordsById] = useState<Map<string, { lat: number; lng: number }>>(new Map())
  const [coordsLoading, setCoordsLoading] = useState(false)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set())
  const [highlightId, setHighlightId] = useState<string | null>(null)

  // Optimized selection (the route preview for whatever is lassoed/checked)
  const [optimized, setOptimized] = useState<OptimizedVisit[] | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)
  const [depotCoord, setDepotCoord] = useState<{ lat: number; lng: number } | null>(null)
  const [usingMatrix, setUsingMatrix] = useState<boolean | null>(null)
  const [geocodeFailed, setGeocodeFailed] = useState<string[]>([])
  const [fallbackStops, setFallbackStops] = useState<string[]>([])

  const initedTechRef = useRef(false)

  // Default to the first tech once users load (one-time, so a deliberate clear sticks)
  useEffect(() => {
    if (!initedTechRef.current && users.length > 0) {
      initedTechRef.current = true
      setSelectedUserIds([users[0].id])
    }
  }, [users])

  // Saved duration_method default
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => { if (data.settings?.duration_method) setDurationMethod(data.settings.duration_method) })
      .catch(() => {})
  }, [])

  // Close tech picker on outside click
  useEffect(() => {
    if (!techPickerOpen) return
    const handler = (e: MouseEvent) => {
      if (techPickerRef.current && !techPickerRef.current.contains(e.target as Node)) setTechPickerOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [techPickerOpen])

  // Scroll the highlighted row into view when a pin is clicked
  useEffect(() => {
    if (!highlightId) return
    const el = document.getElementById(`adv-row-${highlightId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightId])

  function toggleTech(id: string) {
    setSelectedUserIds(curr => curr.includes(id) ? curr.filter(x => x !== id) : [...curr, id])
  }

  const techLabel = (() => {
    if (selectedUserIds.length === 0) return 'Select team member(s)'
    if (selectedUserIds.length === 1) return users.find(u => u.id === selectedUserIds[0])?.name ?? '1 selected'
    if (selectedUserIds.length === 2) {
      return selectedUserIds.map(id => users.find(u => u.id === id)?.name).filter(Boolean).join(' + ')
    }
    return `${selectedUserIds.length} team members`
  })()

  async function geocodeVisits(loaded: Visit[]) {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
    if (!token || loaded.length === 0) { setCoordsById(new Map()); return }
    setCoordsLoading(true)
    const entries = await Promise.all(loaded.map(async v => {
      try {
        const encoded = encodeURIComponent(v.addressString)
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=1&country=US`,
          { signal: AbortSignal.timeout(6000) },
        )
        const data = await res.json()
        const center = data.features?.[0]?.center
        return center ? [v.id, { lng: center[0] as number, lat: center[1] as number }] as const : null
      } catch {
        return null
      }
    }))
    const map = new Map<string, { lat: number; lng: number }>()
    for (const e of entries) if (e) map.set(e[0], e[1])
    setCoordsById(map)
    setCoordsLoading(false)
  }

  async function loadVisits() {
    if (selectedUserIds.length === 0) return
    const days = enumerateDays(startDate, endDate)
    if (days.length === 0) {
      setVisitsError('Pick a valid date range (start on or before end).')
      return
    }
    setVisitsLoading(true)
    setVisitsError(null)
    setVisits(null)
    setOptimized(null)
    setOptimizeError(null)
    setDepotCoord(null)
    setUsingMatrix(null)
    setGeocodeFailed([])
    setFallbackStops([])
    setSelectedIds(new Set())
    setCollapsedDays(new Set())
    setCoordsById(new Map())
    setHighlightId(null)

    try {
      // Fan out one call per (tech × day). Each /api/visits query is capped at
      // 50 visits, so per-day keeps every request comfortably under the cap —
      // a single wide-range query could silently truncate a busy week.
      const combos = days.flatMap(d => selectedUserIds.map(uid => ({ d, uid })))
      const settled = await Promise.all(combos.map(async ({ d, uid }) => {
        const res = await fetch(`/api/visits?date=${d}&userId=${encodeURIComponent(uid)}`)
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        return (data.visits as Visit[]).map(v => ({ ...v, techId: uid, dayDate: d }))
      }))
      const merged = settled.flat()
      setVisits(merged)
      geocodeVisits(merged)
    } catch (e) {
      setVisitsError(e instanceof Error ? e.message : 'Failed to load visits')
    } finally {
      setVisitsLoading(false)
    }
  }

  async function optimizeSelected() {
    const chosen = (visits ?? []).filter(v => selectedIds.has(v.id) && coordsById.has(v.id))
    if (chosen.length < 2) {
      setOptimizeError('Select at least 2 stops (use the lasso or the row checkboxes).')
      return
    }
    setOptimizing(true)
    setOptimizeError(null)
    setGeocodeFailed([])
    setFallbackStops([])
    try {
      const [hh, mm] = startTime.split(':').map(Number)
      const startHour = hh + mm / 60
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addresses: chosen.map(v => v.addressString),
          jobTitles: chosen.map(v => v.jobTitle),
          startHour,
          date: startDate,
          visitLineItems: chosen.map(v => v.lineItemNames ?? []),
          visitTypes: chosen.map(v => v.type ?? 'visit'),
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
        matrixIndices?: number[]
        error?: string
      } = await res.json()
      if (data.error) { setOptimizeError(data.error); return }

      setGeocodeFailed((data.geocodeFailed ?? []).map(i => chosen[i]?.clientName).filter(Boolean) as string[])
      setUsingMatrix(data.usingMatrix ?? false)
      if (data.depotCoord) setDepotCoord(data.depotCoord)
      setFallbackStops((data.legs ?? [])
        .map((leg, i) => leg.usedFallback ? chosen[data.order[i]]?.clientName : null)
        .filter((n): n is string => !!n))

      const reordered: OptimizedVisit[] = data.order.map((originalIdx, newPos) => ({
        ...chosen[originalIdx],
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
      setOptimized(reordered)
    } catch (e) {
      setOptimizeError(e instanceof Error ? e.message : 'Optimization failed')
    } finally {
      setOptimizing(false)
    }
  }

  // ── Derived: visits grouped by day, each day's stops sorted by time then name
  const visitsByDay = useMemo(() => {
    const groups = new Map<string, Visit[]>()
    for (const v of visits ?? []) {
      const arr = groups.get(v.dayDate) ?? []
      arr.push(v)
      groups.set(v.dayDate, arr)
    }
    for (const arr of groups.values()) {
      arr.sort((a, b) => {
        if (a.startAt && b.startAt) return a.startAt.localeCompare(b.startAt)
        if (a.startAt) return -1
        if (b.startAt) return 1
        return a.clientName.localeCompare(b.clientName)
      })
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [visits])

  // ── Derived: map pins ──────────────────────────────────────────────────────
  const routePosById = useMemo(() => {
    const m = new Map<string, { pos: number; lat: number; lng: number }>()
    if (optimized) optimized.forEach((o, i) => m.set(o.id, { pos: i, lat: o.lat, lng: o.lng }))
    return m
  }, [optimized])

  const pins = useMemo<AdvPin[]>(() => {
    const out: AdvPin[] = []
    for (const v of visits ?? []) {
      const route = routePosById.get(v.id)
      const coord = route ? { lat: route.lat, lng: route.lng } : coordsById.get(v.id)
      if (!coord) continue
      const sel = selectedIds.has(v.id)
      out.push({
        id: v.id,
        lat: coord.lat,
        lng: coord.lng,
        label: route ? labelFor(route.pos) : '',
        color: route ? 'c0392b' : sel ? 'e47200' : '64748b',
        selected: sel,
        dimmed: !!optimized && !route,
        title: v.clientName,
        subtitle: v.addressString,
        meta: `${stopTime(v.startAt)}${v.jobTitle ? ' · ' + v.jobTitle : ''}`,
      })
    }
    return out
  }, [visits, coordsById, selectedIds, optimized, routePosById])

  const pathCoords = useMemo(() => {
    if (!optimized || optimized.length === 0 || !depotCoord) return null
    return [depotCoord, ...optimized.map(o => ({ lat: o.lat, lng: o.lng })), depotCoord]
  }, [optimized, depotCoord])

  const selectedCount = selectedIds.size
  const selectedOverMatrixLimit = selectedCount > 24

  function toggleDayCollapse(day: string) {
    setCollapsedDays(prev => {
      const next = new Set(prev)
      if (next.has(day)) next.delete(day); else next.add(day)
      return next
    })
  }

  function selectDay(day: string, on: boolean) {
    const ids = (visits ?? []).filter(v => v.dayDate === day).map(v => v.id)
    setSelectedIds(prev => {
      const next = new Set(prev)
      ids.forEach(id => on ? next.add(id) : next.delete(id))
      return next
    })
  }

  // Optimized-route summary totals
  const totalDriveMin = optimized?.reduce((s, v) => s + v.driveMinutes, 0) ?? 0
  const totalOnSiteMin = optimized?.reduce((s, v) => s + v.onSiteMinutes, 0) ?? 0
  const totalMiles = optimized ? (optimized.reduce((s, v) => s + v.distanceKm, 0) / 1.609).toFixed(1) : '0'

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">Advanced Route Planner</h3>
          <span className="text-xs bg-orange-900/40 text-orange-300 border border-orange-800 px-2 py-0.5 rounded-full">
            Multi-day · lasso select
          </span>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          {/* Date range */}
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs text-gray-400 mb-1">Start date</label>
            <input
              type="date"
              value={startDate}
              max={endDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-base sm:text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs text-gray-400 mb-1">End date</label>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={e => setEndDate(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-base sm:text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          {/* Tech multi-select */}
          <div className="flex-1 min-w-[180px] relative" ref={techPickerRef}>
            <label className="block text-xs text-gray-400 mb-1">Team Member(s)</label>
            {usersLoading ? (
              <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-500">Loading users…</div>
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
                      <button type="button" onClick={() => setSelectedUserIds(users.map(u => u.id))} className="text-orange-400 hover:text-orange-300">Select all</button>
                      <span className="text-gray-700">·</span>
                      <button type="button" onClick={() => setSelectedUserIds([])} className="text-orange-400 hover:text-orange-300">Clear</button>
                      <span className="ml-auto text-gray-500">{selectedUserIds.length} / {users.length}</span>
                    </div>
                    {users.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-gray-500">No team members available. Set the allowlist in <em>Admin → Routing</em>.</div>
                    ) : users.map(u => {
                      const checked = selectedUserIds.includes(u.id)
                      return (
                        <label key={u.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-800">
                          <input type="checkbox" checked={checked} onChange={() => toggleTech(u.id)} className="w-4 h-4 accent-orange-500" />
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
          <div className="w-28">
            <label className="block text-xs text-gray-400 mb-1">Start Time</label>
            <input
              type="time"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-base sm:text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          {/* Duration method */}
          <div className="w-32">
            <label className="block text-xs text-gray-400 mb-1">Duration</label>
            <select
              value={durationMethod}
              onChange={e => setDurationMethod(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-base sm:text-sm text-white focus:outline-none focus:border-orange-500"
            >
              <option value="default">Default</option>
              <option value="formula">Formula</option>
            </select>
          </div>

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

      {/* Errors / warnings */}
      {visitsError && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">{visitsError}</div>
      )}
      {optimizeError && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">Optimization failed: {optimizeError}</div>
      )}
      {geocodeFailed.length > 0 && (
        <div className="bg-yellow-900/40 border border-yellow-700 text-yellow-300 rounded-lg px-4 py-3 text-sm">
          Could not geocode {geocodeFailed.length} address{geocodeFailed.length !== 1 ? 'es' : ''} ({geocodeFailed.join(', ')}) — those stops were excluded from optimization.
        </div>
      )}
      {fallbackStops.length > 0 && (
        <div className="bg-yellow-900/40 border border-yellow-700 text-yellow-300 rounded-lg px-4 py-3 text-sm">
          ⚠️ Duration fallback used for: {fallbackStops.join(', ')} — no matching line items found. Check Duration Rules in Settings.
        </div>
      )}

      {/* Optimized route summary */}
      {optimized && optimized.length > 0 && (
        <div className="bg-gray-900 border border-green-800/60 rounded-2xl p-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold">Optimized selection — {optimized.length} stops</h3>
              {usingMatrix !== null && (
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${usingMatrix ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
                  {usingMatrix ? '🗺 Road times' : '📐 Straight-line'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span>🚗 {Math.floor(totalDriveMin / 60)}h {totalDriveMin % 60}m drive</span>
              <span>⏱ {Math.floor(totalOnSiteMin / 60)}h {totalOnSiteMin % 60}m on-site</span>
              <span>📍 {totalMiles} mi</span>
              <button
                onClick={() => { setOptimized(null); setDepotCoord(null); setUsingMatrix(null) }}
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg font-medium"
              >
                Clear route
              </button>
            </div>
          </div>
          <ol className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            {optimized.map(v => (
              <li key={v.id} className="flex items-center gap-2 text-sm py-1 border-b border-gray-800/60">
                <span className="w-6 h-6 shrink-0 rounded-full bg-red-700 text-white text-xs font-bold flex items-center justify-center">{v.stopNumber}</span>
                <span className="flex-1 min-w-0 truncate text-white">{v.clientName}</span>
                <span className="text-xs text-orange-400 shrink-0">~{v.eta}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-gray-500">
            This is a preview. Saving a route to a holding area (and sending it to Jobber / Daily Log) arrives in the next update.
          </p>
        </div>
      )}

      {/* Main: map + day-grouped list */}
      {visits !== null && (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          {/* Map (large, sticky) */}
          <div className="w-full lg:w-2/3 lg:sticky lg:top-6">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                <h3 className="font-semibold text-sm">Route map</h3>
                <span className="text-xs text-gray-500">{coordsLoading ? 'Locating pins…' : 'Click a pin to inspect · Lasso to select'}</span>
              </div>
              {pins.length > 0 || depotCoord ? (
                <AdvancedRouteMap
                  depotCoord={depotCoord}
                  pins={pins}
                  pathCoords={pathCoords}
                  onLassoSelect={(ids) => setSelectedIds(new Set(ids))}
                  onPinClick={(id) => setHighlightId(id)}
                  highlightId={highlightId}
                />
              ) : (
                <div className="px-4 py-12 text-gray-600 text-sm text-center">
                  {!process.env.NEXT_PUBLIC_MAPBOX_TOKEN
                    ? 'Map unavailable — configure Mapbox token'
                    : coordsLoading ? 'Locating stops…' : 'No stops located on the map yet.'}
                </div>
              )}
            </div>
          </div>

          {/* Day-grouped list (narrow sidebar) */}
          <div className="w-full lg:w-1/3">
            {/* Selection toolbar */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 mb-3 flex items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-semibold text-white">{selectedCount}</span>
                <span className="text-gray-400"> selected</span>
                {selectedOverMatrixLimit && (
                  <span className="block text-xs text-yellow-400 mt-0.5">Over 24 — road times unavailable, will use straight-line</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selectedCount > 0 && (
                  <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-xs font-medium">Clear</button>
                )}
                <button
                  onClick={optimizeSelected}
                  disabled={optimizing || selectedCount < 2}
                  className="px-4 py-1.5 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  {optimizing ? 'Optimizing…' : `⚡ Optimize ${selectedCount || ''}`.trim()}
                </button>
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              {visits.length === 0 ? (
                <p className="px-6 py-8 text-gray-500 text-sm text-center">No visits found for this date range and team.</p>
              ) : (
                visitsByDay.map(([day, dayVisits]) => {
                  const collapsed = collapsedDays.has(day)
                  const daySelected = dayVisits.filter(v => selectedIds.has(v.id)).length
                  const allDaySelected = daySelected === dayVisits.length && dayVisits.length > 0
                  return (
                    <div key={day} className="border-b border-gray-800 last:border-b-0">
                      <div className="px-4 py-2.5 bg-gray-950/50 flex items-center gap-3">
                        <button onClick={() => toggleDayCollapse(day)} className="text-gray-500 text-xs w-4 shrink-0" title={collapsed ? 'Expand' : 'Collapse'}>
                          {collapsed ? '▶' : '▼'}
                        </button>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-semibold text-white">{dayHeading(day)}</span>
                          <span className="text-xs text-gray-500 ml-2">{dayVisits.length} stop{dayVisits.length !== 1 ? 's' : ''}{daySelected > 0 ? ` · ${daySelected} selected` : ''}</span>
                        </div>
                        <button
                          onClick={() => selectDay(day, !allDaySelected)}
                          className="text-xs text-orange-400 hover:text-orange-300 shrink-0"
                        >
                          {allDaySelected ? 'Deselect' : 'Select day'}
                        </button>
                      </div>
                      {!collapsed && (
                        <ul className="divide-y divide-gray-800/60">
                          {dayVisits.map(v => {
                            const sel = selectedIds.has(v.id)
                            const route = routePosById.get(v.id)
                            const hl = highlightId === v.id
                            const located = coordsById.has(v.id) || !!route
                            return (
                              <li
                                key={v.id}
                                id={`adv-row-${v.id}`}
                                className={`px-4 py-2.5 flex gap-2.5 items-start cursor-pointer transition-colors ${hl ? 'bg-orange-500/10 ring-1 ring-inset ring-orange-500/40' : 'hover:bg-gray-800/40'}`}
                                onClick={() => setHighlightId(v.id)}
                              >
                                <input
                                  type="checkbox"
                                  checked={sel}
                                  onClick={e => e.stopPropagation()}
                                  onChange={e => {
                                    setSelectedIds(prev => {
                                      const next = new Set(prev)
                                      if (e.target.checked) next.add(v.id); else next.delete(v.id)
                                      return next
                                    })
                                  }}
                                  className="mt-1 w-4 h-4 shrink-0 accent-orange-500 cursor-pointer"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    {route && (
                                      <span className="w-5 h-5 shrink-0 rounded-full bg-red-700 text-white text-[10px] font-bold flex items-center justify-center">{route.pos < 9 ? route.pos + 1 : labelFor(route.pos)}</span>
                                    )}
                                    <p className="font-medium text-sm text-white truncate">{v.clientName}</p>
                                    {!located && <span className="shrink-0 text-[10px] text-yellow-500" title="Address could not be located on the map">⚠</span>}
                                  </div>
                                  <p className="text-xs text-gray-400 truncate">{v.addressString}</p>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    <span className="text-[11px] text-orange-300">{stopTime(v.startAt)}</span>
                                    {v.jobTitle && (
                                      <span className="text-[10px] bg-gray-800 text-gray-300 border border-gray-700 px-1.5 py-0.5 rounded truncate max-w-[160px]">{v.jobTitle}</span>
                                    )}
                                    {selectedUserIds.length > 1 && (
                                      <span className="text-[10px] bg-purple-900/40 text-purple-300 border border-purple-800 px-1.5 py-0.5 rounded">{users.find(u => u.id === v.techId)?.name?.split(' ')[0] ?? 'tech'}</span>
                                    )}
                                  </div>
                                </div>
                                {v.totalPrice > 0 && <span className="text-xs text-gray-500 shrink-0">${v.totalPrice.toFixed(0)}</span>}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
