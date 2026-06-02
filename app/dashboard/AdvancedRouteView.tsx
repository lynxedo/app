'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import AdvancedRouteMap, { type AdvPin } from '@/components/AdvancedRouteMap'
import { buildAdvancedRouteSheetHtml, type RouteSheetStop } from '@/lib/advanced-route-sheet'
import { resolvePinColors, DEFAULT_PIN_COLOR, MAX_HALO_ARCS, EMPTY_PIN_SETTINGS, type PinSettings } from '@/lib/pin-colors'

interface JobberUser { id: string; name: string }

interface LineItem { name: string; qty: number; unitPrice: number; totalPrice: number }

// ── Holding-area batch (persisted in route_batches) ─────────────────────────
// A batch is a lassoed + optimized set of stops parked for a future day/tech.
// `stops` is a superset that lets us rebuild all four send payloads later.
interface BatchStop {
  ord: number
  jobber_visit_id: string
  client_name: string
  client_phone: string | null
  address: string
  lat: number | null
  lng: number | null
  job_title: string | null
  line_items: LineItem[]
  instructions: string | null
  services: string
  total_price: number
  eta: string
  start_at_iso: string | null
  end_at_iso: string | null
  drive_minutes: number
  onsite_minutes: number
  distance_km: number
  original_day: string   // the YYYY-MM-DD this visit is currently scheduled in Jobber
}

interface RouteBatch {
  id: string
  label: string | null
  assigned_date: string
  assigned_tech_jobber_id: string | null
  assigned_tech_name: string | null
  stops: BatchStop[]
  total_drive_minutes: number
  total_onsite_minutes: number
  total_miles: number
  depot_lat: number | null
  depot_lng: number | null
  sent_to_jobber_at: string | null
  sent_to_daily_log_at: string | null
  created_at: string
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
  jobId: string | null  // Jobber Job ID — used to look up days-since-last-visit
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

// Resizable stop-list panel (desktop only) — drag the divider to enlarge the map.
const LIST_W_KEY = 'lynxedo-adv-route-list-width'
const MIN_LIST_W = 260
const DEFAULT_LIST_W = 380

export default function AdvancedRouteView({ users, usersLoading, usersError }: AdvancedRouteViewProps) {
  const [startDate, setStartDate] = useState(todayLocal())
  const [endDate, setEndDate] = useState(todayLocal())

  // ── Resizable stop-list panel (desktop only) ──────────────────────────────
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_W)
  const [isDesktop, setIsDesktop] = useState(false)
  const mapRowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    try {
      const n = parseInt(localStorage.getItem(LIST_W_KEY) || '', 10)
      if (!isNaN(n) && n >= MIN_LIST_W) setListWidth(n)
    } catch { /* ignore */ }
    const mq = window.matchMedia('(min-width: 1024px)')
    const update = () => setIsDesktop(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  function startListResize(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = listWidth
    let latest = startW
    const move = (ev: MouseEvent) => {
      // Cap the list at 70% of the row so the map keeps at least ~30%.
      const maxW = Math.floor((mapRowRef.current?.offsetWidth ?? 1200) * 0.7)
      const delta = startX - ev.clientX // drag left → wider list, right → narrower
      latest = Math.max(MIN_LIST_W, Math.min(maxW, startW + delta))
      setListWidth(latest)
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      try { localStorage.setItem(LIST_W_KEY, String(latest)) } catch { /* ignore */ }
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }
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

  // Company pin-color settings (base/aux programs → pin fill + halo). Read-only here.
  const [pinSettings, setPinSettings] = useState<PinSettings>(EMPTY_PIN_SETTINGS)
  // Lasso behavior: drag to add to (select) or remove from (deselect) the selection.
  const [lassoMode, setLassoMode] = useState<'select' | 'deselect'>('select')

  // Days since last completed visit, keyed by Jobber Job ID. Loaded asynchronously
  // after the visit list renders — pins update once data arrives.
  const [daysSinceByJobId, setDaysSinceByJobId] = useState<Map<string, number | null>>(new Map())

  // Optimized selection (the route preview for whatever is lassoed/checked)
  const [optimized, setOptimized] = useState<OptimizedVisit[] | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)
  const [depotCoord, setDepotCoord] = useState<{ lat: number; lng: number } | null>(null)
  const [usingMatrix, setUsingMatrix] = useState<boolean | null>(null)
  const [geocodeFailed, setGeocodeFailed] = useState<string[]>([])
  const [fallbackStops, setFallbackStops] = useState<string[]>([])

  // ── Holding area (batches) ──────────────────────────────────────────────
  const [batches, setBatches] = useState<RouteBatch[]>([])
  const [batchesError, setBatchesError] = useState<string | null>(null)
  const [holdingCollapsed, setHoldingCollapsed] = useState(false)
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null)
  // Per-batch in-flight action + result message, keyed by batch id.
  const [batchBusy, setBatchBusy] = useState<Record<string, string | null>>({})
  const [batchMsg, setBatchMsg] = useState<Record<string, { ok: boolean; text: string }>>({})
  // Pre-holding modal (assign day + tech + label before parking the selection).
  const [holdingModalOpen, setHoldingModalOpen] = useState(false)
  const [batchDate, setBatchDate] = useState(todayLocal())
  const [batchTechId, setBatchTechId] = useState<string>('')
  const [batchLabel, setBatchLabel] = useState('')
  const [creatingBatch, setCreatingBatch] = useState(false)

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

  // Company pin-color settings (base/aux programs). Drives pin fill + halo colors.
  useEffect(() => {
    fetch('/api/routing/pin-settings')
      .then(r => r.json())
      .then(data => { if (data.pin_settings) setPinSettings(data.pin_settings) })
      .catch(() => {})
  }, [])

  // When visits load, fetch days-since-last-visit for every unique job ID in the
  // result set. Runs in the background — pin labels update once data arrives.
  // Clears on null (new load started) so stale counts never show on the wrong set.
  useEffect(() => {
    if (!visits) { setDaysSinceByJobId(new Map()); return }
    const jobIds = [...new Set(visits.flatMap(v => (v.jobId ? [v.jobId] : [])))]
    if (jobIds.length === 0) return
    fetch(`/api/routing/last-visit-dates?jobIds=${jobIds.join(',')}`)
      .then(r => r.json())
      .then((data: Record<string, number | null>) => {
        setDaysSinceByJobId(new Map(Object.entries(data)))
      })
      .catch(() => {})
  }, [visits])

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

  // ── Holding area: load / create / send / delete ──────────────────────────
  async function loadBatches() {
    try {
      const res = await fetch('/api/hub/routing/batches')
      const data = await res.json()
      if (data.error) { setBatchesError(data.error); return }
      setBatches((data.batches ?? []) as RouteBatch[])
      setBatchesError(null)
    } catch (e) {
      setBatchesError(e instanceof Error ? e.message : 'Failed to load holding area')
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadBatches() }, [])

  // Re-stamp an optimize-time ISO ("YYYY-MM-DDTHH:MM:SS") onto the batch's
  // assigned date — keeps the clock time, moves the calendar day.
  function swapDate(iso: string | null, date: string): string | null {
    if (!iso) return null
    const t = iso.split('T')[1] ?? '00:00:00'
    return `${date}T${t}`
  }

  function batchTitle(b: RouteBatch): string {
    if (b.label) return b.label
    const day = new Date(b.assigned_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const tech = b.assigned_tech_name?.split(/\s+/)[0] ?? 'Unassigned'
    return `${day} · ${tech}`
  }

  function openHoldingModal() {
    if (!optimized || optimized.length === 0) return
    const firstDay = optimized[0]?.dayDate ?? startDate
    const firstTech = optimized[0]?.techId ?? selectedUserIds[0] ?? ''
    setBatchDate(firstDay)
    setBatchTechId(firstTech)
    const dayShort = new Date(firstDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const techFirst = users.find(u => u.id === firstTech)?.name?.split(/\s+/)[0] ?? ''
    setBatchLabel(techFirst ? `${dayShort} · ${techFirst}` : dayShort)
    setHoldingModalOpen(true)
  }

  async function createBatch() {
    if (!optimized || optimized.length === 0) return
    setCreatingBatch(true)
    setBatchesError(null)
    const techName = users.find(u => u.id === batchTechId)?.name ?? null
    const stops: BatchStop[] = optimized.map(v => ({
      ord: v.stopNumber,
      jobber_visit_id: v.id,
      client_name: v.clientName,
      client_phone: v.phone,
      address: v.addressString,
      lat: v.lat,
      lng: v.lng,
      job_title: v.jobTitle,
      line_items: v.lineItems,
      instructions: v.instructions,
      services: v.services,
      total_price: v.totalPrice,
      eta: v.eta,
      start_at_iso: v.startAtISO,
      end_at_iso: v.endAtISO,
      drive_minutes: v.driveMinutes,
      onsite_minutes: v.onSiteMinutes,
      distance_km: v.distanceKm,
      original_day: v.dayDate,
    }))
    try {
      const res = await fetch('/api/hub/routing/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: batchLabel.trim() || null,
          assigned_date: batchDate,
          assigned_tech_jobber_id: batchTechId || null,
          assigned_tech_name: techName,
          stops,
          total_drive_minutes: optimized.reduce((s, v) => s + v.driveMinutes, 0),
          total_onsite_minutes: optimized.reduce((s, v) => s + v.onSiteMinutes, 0),
          total_miles: optimized.reduce((s, v) => s + v.distanceKm, 0) / 1.609,
          depot_lat: depotCoord?.lat ?? null,
          depot_lng: depotCoord?.lng ?? null,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setBatchesError(data.error || `Failed to save batch (${res.status})`)
        return
      }
      // Success: the new batch's stops are now "held" → they vanish from the
      // map + list so the remaining stops can be lassoed into the next batch.
      setHoldingModalOpen(false)
      setOptimized(null)
      setDepotCoord(null)
      setUsingMatrix(null)
      setSelectedIds(new Set())
      setBatchLabel('')
      await loadBatches()
    } catch (e) {
      setBatchesError(e instanceof Error ? e.message : 'Failed to save batch')
    } finally {
      setCreatingBatch(false)
    }
  }

  // Generic per-batch action runner: tracks busy state, captures a result
  // message, and on success stamps the send channel + reloads.
  async function runBatchAction(
    batchId: string,
    action: string,
    fn: () => Promise<{ ok: boolean; text: string; channel?: 'jobber' | 'daily_log' }>,
  ) {
    setBatchBusy(prev => ({ ...prev, [batchId]: action }))
    setBatchMsg(prev => { const n = { ...prev }; delete n[batchId]; return n })
    try {
      const result = await fn()
      setBatchMsg(prev => ({ ...prev, [batchId]: { ok: result.ok, text: result.text } }))
      if (result.ok && result.channel) {
        await fetch(`/api/hub/routing/batches/${batchId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: result.channel }),
        })
        await loadBatches()
      }
    } catch (e) {
      setBatchMsg(prev => ({ ...prev, [batchId]: { ok: false, text: e instanceof Error ? e.message : 'Failed' } }))
    } finally {
      setBatchBusy(prev => ({ ...prev, [batchId]: null }))
    }
  }

  function orderedStops(b: RouteBatch): BatchStop[] {
    return [...b.stops].sort((a, z) => a.ord - z.ord)
  }

  function sendBatchOrderOnly(b: RouteBatch) {
    const stops = orderedStops(b)
    runBatchAction(b.id, 'order', async () => {
      const res = await fetch('/api/reorder-jobber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visit_ids: stops.map(s => s.jobber_visit_id),
          assigned_user_id: b.assigned_tech_jobber_id ?? null,
          assigned_date: b.assigned_date,
        }),
      })
      const data = await res.json() as { results?: Array<{ success: boolean }>; allOk?: boolean; error?: string }
      if (data.error) return { ok: false, text: data.error }
      const okCount = data.results?.filter(r => r.success).length ?? 0
      return data.allOk
        ? { ok: true, channel: 'jobber', text: `Order sent to Jobber (${okCount} stops)` }
        : { ok: false, text: `Partial: ${okCount}/${stops.length} reordered` }
    })
  }

  function sendBatchWithTimes(b: RouteBatch) {
    const stops = orderedStops(b)
    const visitsPayload = stops
      .filter(s => s.start_at_iso && s.end_at_iso)
      .map(s => ({
        visitId: s.jobber_visit_id,
        startAt: swapDate(s.start_at_iso, b.assigned_date)!,
        endAt: swapDate(s.end_at_iso, b.assigned_date)!,
      }))
    if (visitsPayload.length === 0) {
      setBatchMsg(prev => ({ ...prev, [b.id]: { ok: false, text: 'No stops have times — re-optimize before parking.' } }))
      return
    }
    runBatchAction(b.id, 'times', async () => {
      const res = await fetch('/api/send-to-jobber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visits: visitsPayload, assignedUserId: b.assigned_tech_jobber_id ?? null }),
      })
      const data = await res.json() as { results?: Array<{ success: boolean }>; allOk?: boolean; error?: string }
      if (data.error) return { ok: false, text: data.error }
      const okCount = data.results?.filter(r => r.success).length ?? 0
      return data.allOk
        ? { ok: true, channel: 'jobber', text: `Times sent for ${b.assigned_date} (${okCount} stops)` }
        : { ok: false, text: `Partial: ${okCount}/${visitsPayload.length} updated` }
    })
  }

  function sendBatchDailyLogV2(b: RouteBatch) {
    if (!b.assigned_tech_name) {
      setBatchMsg(prev => ({ ...prev, [b.id]: { ok: false, text: 'Batch has no assigned tech — cannot send to Daily Log.' } }))
      return
    }
    const stops = orderedStops(b).map(s => ({
      jobber_visit_id: s.jobber_visit_id,
      client_name: s.client_name,
      client_phone: s.client_phone,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      job_title: s.job_title,
      line_items: s.line_items,
      instructions: s.instructions,
      scheduled_start_at: swapDate(s.start_at_iso, b.assigned_date),
      scheduled_end_at: swapDate(s.end_at_iso, b.assigned_date),
      duration_minutes: s.onsite_minutes,
    }))
    runBatchAction(b.id, 'dlv2', async () => {
      const res = await fetch('/api/hub/daily-log/from-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_date: b.assigned_date,
          tech_jobber_user_id: b.assigned_tech_jobber_id,
          tech_jobber_user_name: b.assigned_tech_name,
          stops,
        }),
      })
      const data = await res.json() as { stop_count?: number; action?: string; error?: string }
      if (!res.ok || data.error) return { ok: false, text: data.error || `Failed (${res.status})` }
      return { ok: true, channel: 'daily_log', text: `Daily Log v2 ${data.action ?? 'sent'} (${data.stop_count} stops)` }
    })
  }

  function sendBatchDailyLogV1(b: RouteBatch) {
    if (!b.assigned_tech_name) {
      setBatchMsg(prev => ({ ...prev, [b.id]: { ok: false, text: 'Batch has no assigned tech — cannot send to Daily Log.' } }))
      return
    }
    runBatchAction(b.id, 'dlv1', async () => {
      const sheetStops: RouteSheetStop[] = orderedStops(b).map(s => ({
        stopNumber: s.ord,
        clientName: s.client_name,
        addressString: s.address,
        phone: s.client_phone,
        jobTitle: s.job_title ?? '',
        eta: s.eta,
        driveMinutes: s.drive_minutes,
        onSiteMinutes: s.onsite_minutes,
        distanceKm: s.distance_km,
        lat: s.lat ?? 0,
        lng: s.lng ?? 0,
        lineItems: s.line_items,
        services: s.services,
        totalPrice: s.total_price,
        instructions: s.instructions,
      }))
      const html = await buildAdvancedRouteSheetHtml({
        techName: b.assigned_tech_name!,
        date: b.assigned_date,
        stops: sheetStops,
        depot: (b.depot_lat != null && b.depot_lng != null) ? { lat: b.depot_lat, lng: b.depot_lng } : null,
        mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '',
      })
      if (!html) return { ok: false, text: 'Failed to build route sheet.' }
      const res = await fetch('/api/hub/daily-log/from-route-v1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_date: b.assigned_date,
          tech_jobber_user_id: b.assigned_tech_jobber_id,
          tech_jobber_user_name: b.assigned_tech_name,
          route_html: html,
          route_name: `${b.assigned_tech_name} - ${b.assigned_date}.html`,
        }),
      })
      const data = await res.json() as { action?: string; error?: string }
      if (!res.ok || data.error) return { ok: false, text: data.error || `Failed (${res.status})` }
      return { ok: true, channel: 'daily_log', text: `Daily Log v1 ${data.action ?? 'sent'}` }
    })
  }

  function deleteBatch(b: RouteBatch) {
    if (!window.confirm(`Delete "${batchTitle(b)}"? Its ${b.stops.length} stop(s) will return to the map and list.`)) return
    runBatchAction(b.id, 'delete', async () => {
      const res = await fetch(`/api/hub/routing/batches/${b.id}`, { method: 'DELETE' })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || data.error) return { ok: false, text: data.error || 'Delete failed' }
      await loadBatches()
      return { ok: true, text: 'Deleted' }
    })
  }

  // Visit IDs parked in any existing batch — hidden from the live map + list
  // until that batch is deleted. Seeded from the DB so it survives a refresh.
  const heldVisitIds = useMemo(
    () => new Set(batches.flatMap(b => b.stops.map(s => s.jobber_visit_id))),
    [batches],
  )

  // ── Derived: visits grouped by day, each day's stops sorted by time then name
  const visitsByDay = useMemo(() => {
    const groups = new Map<string, Visit[]>()
    for (const v of visits ?? []) {
      if (heldVisitIds.has(v.id)) continue   // parked in a holding batch — hide
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
  }, [visits, heldVisitIds])

  // ── Derived: map pins ──────────────────────────────────────────────────────
  const routePosById = useMemo(() => {
    const m = new Map<string, { pos: number; lat: number; lng: number }>()
    if (optimized) optimized.forEach((o, i) => m.set(o.id, { pos: i, lat: o.lat, lng: o.lng }))
    return m
  }, [optimized])

  const pins = useMemo<AdvPin[]>(() => {
    const out: AdvPin[] = []
    for (const v of visits ?? []) {
      if (heldVisitIds.has(v.id)) continue   // parked in a holding batch — hide
      const route = routePosById.get(v.id)
      const coord = route ? { lat: route.lat, lng: route.lng } : coordsById.get(v.id)
      if (!coord) continue
      const sel = selectedIds.has(v.id)
      // Program color wins the center fill — selection is shown by the glow, not by
      // recoloring — and aux programs form the halo. Falls back to slate when no base
      // program matches. The route-order number still shows once optimized.
      const { baseColor, auxColors } = resolvePinColors(v.lineItemNames, pinSettings)
      // Optimized stops show their route-order number; unoptimized stops show
      // the days since the last completed visit on this job (loaded async).
      const pinLabel = (() => {
        if (route) return labelFor(route.pos)
        if (v.jobId) {
          const days = daysSinceByJobId.get(v.jobId)
          if (typeof days === 'number') return String(days)
        }
        return ''
      })()
      out.push({
        id: v.id,
        lat: coord.lat,
        lng: coord.lng,
        label: pinLabel,
        color: baseColor ?? DEFAULT_PIN_COLOR,
        auxColors: auxColors.slice(0, MAX_HALO_ARCS),
        selected: sel,
        dimmed: !!optimized && !route,
        title: v.clientName,
        subtitle: v.addressString,
        meta: `${stopTime(v.startAt)}${v.jobTitle ? ' · ' + v.jobTitle : ''}`,
      })
    }
    return out
  }, [visits, coordsById, selectedIds, optimized, routePosById, heldVisitIds, pinSettings, daysSinceByJobId])

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
          <div className="mt-4 flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-gray-800">
            <p className="text-xs text-gray-500 max-w-md">
              Park this route in the holding area to assign it a day + tech. It leaves the map and list so you can keep building other days; send it to Jobber / Daily Log later.
            </p>
            <button
              onClick={openHoldingModal}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-colors shrink-0"
            >
              📥 Send to Holding →
            </button>
          </div>
        </div>
      )}

      {/* Pre-holding modal: assign day + tech + label before parking. */}
      {holdingModalOpen && optimized && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !creatingBatch && setHoldingModalOpen(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-1">Send {optimized.length} stops to holding</h3>
            <p className="text-xs text-gray-400 mb-4">Assign the day and tech this route is for. You can send it to Jobber / Daily Log from the holding area afterward.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Day this route is for</label>
                <input
                  type="date"
                  value={batchDate}
                  onChange={e => setBatchDate(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-base sm:text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Tech</label>
                <select
                  value={batchTechId}
                  onChange={e => setBatchTechId(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-base sm:text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">— Unassigned —</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                {!batchTechId && (
                  <p className="text-[11px] text-yellow-400 mt-1">A tech is required to send to Daily Log.</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Label (optional)</label>
                <input
                  type="text"
                  value={batchLabel}
                  onChange={e => setBatchLabel(e.target.value)}
                  placeholder="e.g. Mon Jun 8 · Mike"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-base sm:text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
            {batchesError && <p className="text-red-400 text-xs mt-3">{batchesError}</p>}
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setHoldingModalOpen(false)} disabled={creatingBatch} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-sm font-medium disabled:opacity-50">Cancel</button>
              <button onClick={createBatch} disabled={creatingBatch} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-semibold">
                {creatingBatch ? 'Saving…' : 'Send to Holding'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main: map + day-grouped list */}
      {visits !== null && (
        <div ref={mapRowRef} className="flex flex-col lg:flex-row gap-4 items-start">
          {/* Map (large, sticky) — grows to fill whatever the resizable list leaves */}
          <div className="w-full lg:flex-1 lg:min-w-0 lg:sticky lg:top-6">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                <h3 className="font-semibold text-sm">Route map</h3>
                <span className="text-xs text-gray-500">{coordsLoading ? 'Locating pins…' : 'Click a pin to inspect · Lasso to select/deselect'}</span>
              </div>

              {/* Pin color legend — base = filled center, aux = halo ring */}
              {(pinSettings.base_programs.length > 0 || pinSettings.aux_programs.length > 0) && (
                <div className="px-4 py-2.5 border-b border-gray-800 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
                  {pinSettings.base_programs.map(p => (
                    <span key={p.id} className="flex items-center gap-1.5 text-gray-300">
                      <span className="w-3 h-3 rounded-full border border-white/40" style={{ background: p.color }} />
                      {p.label}
                    </span>
                  ))}
                  {pinSettings.base_programs.length > 0 && pinSettings.aux_programs.length > 0 && (
                    <span className="text-gray-700">|</span>
                  )}
                  {pinSettings.aux_programs.map((p, i) => (
                    <span key={p.id} className={`flex items-center gap-1.5 ${i < MAX_HALO_ARCS ? 'text-gray-400' : 'text-gray-600'}`}>
                      <span className="w-3 h-3 rounded-full bg-transparent" style={{ border: `2px solid ${p.color}` }} />
                      {p.label}{i >= MAX_HALO_ARCS ? ' (not on halo)' : ''}
                    </span>
                  ))}
                </div>
              )}
              {pins.length > 0 || depotCoord ? (
                <AdvancedRouteMap
                  depotCoord={depotCoord}
                  pins={pins}
                  pathCoords={pathCoords}
                  onLassoSelect={(ids) => setSelectedIds(prev => {
                    const next = new Set(prev)
                    if (lassoMode === 'deselect') ids.forEach(id => next.delete(id))
                    else ids.forEach(id => next.add(id))
                    return next
                  })}
                  onPinClick={(id) => setHighlightId(id)}
                  highlightId={highlightId}
                  lassoMode={lassoMode}
                  onLassoModeChange={setLassoMode}
                  onClearSelection={() => setSelectedIds(new Set())}
                  selectedCount={selectedCount}
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

          {/* Drag handle — desktop only. Drag left to enlarge the list, right to enlarge the map. */}
          <div
            className="hidden lg:block flex-none w-2 cursor-col-resize group lg:sticky lg:top-6"
            style={{ height: '70vh' }}
            onMouseDown={startListResize}
            title="Drag to resize the map and list"
          >
            <div className="mx-auto w-px h-full bg-gray-700 group-hover:bg-orange-500/70 transition-colors" />
          </div>

          {/* Day-grouped list (resizable sidebar on desktop, full width on mobile) */}
          <div className="w-full lg:flex-none" style={isDesktop ? { width: listWidth } : undefined}>
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

      {/* ── Holding area ──────────────────────────────────────────────────── */}
      {batches.length > 0 && (
        <div className="bg-gray-900 border border-indigo-900/50 rounded-2xl overflow-hidden">
          <button
            onClick={() => setHoldingCollapsed(c => !c)}
            className="w-full px-5 py-3 flex items-center gap-2 bg-indigo-950/30 hover:bg-indigo-950/50 transition-colors"
          >
            <span className="text-indigo-300 text-xs">{holdingCollapsed ? '▶' : '▼'}</span>
            <h3 className="font-semibold">📥 Holding area</h3>
            <span className="text-xs text-gray-400">
              {batches.length} batch{batches.length !== 1 ? 'es' : ''} · {batches.reduce((s, b) => s + b.stops.length, 0)} stops
            </span>
          </button>
          {!holdingCollapsed && (
            <div className="divide-y divide-gray-800">
              {batchesError && <p className="px-5 py-3 text-red-400 text-sm">{batchesError}</p>}
              {batches.map(b => {
                const expanded = expandedBatchId === b.id
                const busy = batchBusy[b.id]
                const msg = batchMsg[b.id]
                const stops = orderedStops(b)
                const dayLabel = new Date(b.assigned_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
                return (
                  <div key={b.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <button onClick={() => setExpandedBatchId(expanded ? null : b.id)} className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-gray-500 text-xs">{expanded ? '▼' : '▶'}</span>
                          <span className="font-semibold text-white">{batchTitle(b)}</span>
                          {b.sent_to_jobber_at && <span className="text-[10px] bg-green-900/50 text-green-300 border border-green-800 px-1.5 py-0.5 rounded-full">✓ Jobber</span>}
                          {b.sent_to_daily_log_at && <span className="text-[10px] bg-green-900/50 text-green-300 border border-green-800 px-1.5 py-0.5 rounded-full">✓ Daily Log</span>}
                        </div>
                        <div className="text-xs text-gray-400 mt-1 ml-5">
                          {dayLabel} · {b.assigned_tech_name ?? 'Unassigned'} · {stops.length} stops · 🚗 {Math.floor(b.total_drive_minutes / 60)}h {b.total_drive_minutes % 60}m · ⏱ {Math.floor(b.total_onsite_minutes / 60)}h {b.total_onsite_minutes % 60}m
                        </div>
                      </button>
                      <button onClick={() => deleteBatch(b)} disabled={!!busy} className="text-xs text-red-400 hover:text-red-300 shrink-0 disabled:opacity-50">
                        {busy === 'delete' ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                    {expanded && (
                      <div className="mt-3 ml-5 space-y-3">
                        <ol className="space-y-1">
                          {stops.map(s => (
                            <li key={s.jobber_visit_id} className="flex items-center gap-2 text-sm">
                              <span className="w-5 h-5 shrink-0 rounded-full bg-indigo-700 text-white text-[10px] font-bold flex items-center justify-center">{s.ord}</span>
                              <span className="flex-1 min-w-0 truncate text-gray-200">{s.client_name}</span>
                              <span className="hidden sm:block text-xs text-gray-500 truncate max-w-[40%]">{s.address}</span>
                              <span className="text-xs text-orange-400 shrink-0">{s.eta}</span>
                            </li>
                          ))}
                        </ol>
                        <div className="flex flex-wrap gap-2 pt-2">
                          <button onClick={() => sendBatchOrderOnly(b)} disabled={!!busy} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-100 rounded-lg text-xs font-medium">
                            {busy === 'order' ? 'Sending…' : 'Send Order Only'}
                          </button>
                          <button onClick={() => sendBatchWithTimes(b)} disabled={!!busy} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium">
                            {busy === 'times' ? 'Sending…' : 'Send with Times'}
                          </button>
                          <button onClick={() => sendBatchDailyLogV1(b)} disabled={!!busy} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium">
                            {busy === 'dlv1' ? 'Sending…' : 'Send to Daily Log v1'}
                          </button>
                          <button onClick={() => sendBatchDailyLogV2(b)} disabled={!!busy} className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium">
                            {busy === 'dlv2' ? 'Sending…' : 'Send to Daily Log v2'}
                          </button>
                        </div>
                        {msg && <p className={`text-xs ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
