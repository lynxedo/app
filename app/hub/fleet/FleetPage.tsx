'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { GeoJSONSource, Map as MapboxMap, Marker as MapboxMarker, Popup as MapboxPopup } from 'mapbox-gl'

// The mapbox-gl engine (~800 KB) is browser-only and heavy, so it's lazy-loaded
// inside the init effect via `await import('mapbox-gl')` rather than a static
// top-level import — it stays out of the initial Fleet bundle entirely.
type MapboxModule = (typeof import('mapbox-gl'))['default']

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
const POLL_INTERVAL_MS = 30_000

type Device = {
  id: string
  name: string
  lat: number
  lng: number
  speed_mph: number
  heading: number
  drive_status: 'driving' | 'idle' | 'off' | 'towing' | 'unknown'
  fuel_pct: number | null
  last_ping: string
}

type AlertEvent = {
  id: string
  device_id: string
  device_name: string
  alert_type: 'speeding' | 'after_hours' | 'low_fuel' | 'offline'
  started_at: string
  last_seen_at: string
  payload: Record<string, unknown>
}

function statusColor(status: Device['drive_status']): string {
  switch (status) {
    case 'driving': return '#22c55e' // green
    case 'idle':    return '#f59e0b' // amber — engine on, parked at a job
    case 'towing':  return '#f97316' // orange
    case 'off':
    case 'unknown':
    default:        return '#6b7280' // gray
  }
}

function statusLabel(status: Device['drive_status']): string {
  switch (status) {
    case 'driving': return 'Driving'
    case 'idle':    return 'Idle'
    case 'towing':  return 'Towing'
    case 'off':     return 'Off'
    default:        return 'Unknown'
  }
}

function alertLabel(type: AlertEvent['alert_type']): string {
  switch (type) {
    case 'speeding':   return '🚨 Speeding'
    case 'after_hours':return '🌙 After-hours'
    case 'low_fuel':   return '⛽ Low fuel'
    case 'offline':    return '📡 Offline'
  }
}

// --- Day History (historical breadcrumb path) ---

type HistoryPoint = {
  t: string
  lat: number
  lng: number
  speed_mph: number
  drive_status: Device['drive_status']
}
type HistoryStop = { lat: number; lng: number; start: string; end: string; minutes: number }
type DayHistory = { points: HistoryPoint[]; stops: HistoryStop[] }

// --- Work Order stops (Fleet stops PRD session 1) ---

type StopStatus = 'done' | 'skipped' | 'open'
type FleetStop = {
  id: string
  n: number
  lat: number
  lng: number
  client_name: string
  services: string[]
  scheduled_start_at: string | null
  status: StopStatus
  completed_at: string | null
  is_next: boolean
}
type StopsTech = {
  user_id: string
  name: string
  color: string
  device_id: string | null
  total: number
  stops: FleetStop[]
}
type Driver = { device_id: string; user_id: string; name: string; color: string | null }
type StopsDay = { date: string; techs: StopsTech[]; drivers: Driver[] }

const DONE_GREY = '#9ca3af'

function buildStopEl(stop: FleetStop, color: string): HTMLDivElement {
  const wrap = document.createElement('div')
  // No inline `position` (see buildMarkerEl). Below the truck pins.
  wrap.style.zIndex = '1'
  wrap.style.cursor = 'pointer'

  const pin = document.createElement('div')
  const finished = stop.status !== 'open'
  pin.style.width = '24px'
  pin.style.height = '24px'
  pin.style.borderRadius = '50%'
  pin.style.display = 'flex'
  pin.style.alignItems = 'center'
  pin.style.justifyContent = 'center'
  pin.style.font = '700 12px/1 system-ui, sans-serif'
  pin.style.color = 'white'
  pin.style.background = finished ? DONE_GREY : color
  pin.style.border = '2px solid white'
  pin.style.opacity = stop.status === 'skipped' ? '0.75' : '1'
  // The next stop gets a ring in the tech's colour outside the white border.
  pin.style.boxShadow = stop.is_next
    ? `0 0 0 3px ${color}, 0 2px 6px rgba(0,0,0,0.5)`
    : '0 1px 3px rgba(0,0,0,0.4)'
  pin.textContent = String(stop.n)
  wrap.appendChild(pin)

  if (finished) {
    const badge = document.createElement('div')
    badge.style.position = 'absolute'
    badge.style.top = '-5px'
    badge.style.right = '-6px'
    badge.style.width = '14px'
    badge.style.height = '14px'
    badge.style.borderRadius = '50%'
    badge.style.display = 'flex'
    badge.style.alignItems = 'center'
    badge.style.justifyContent = 'center'
    badge.style.font = '700 10px/1 system-ui, sans-serif'
    badge.style.color = 'white'
    badge.style.border = '1.5px solid white'
    badge.style.background = stop.status === 'done' ? '#16a34a' : '#6b7280'
    badge.textContent = stop.status === 'done' ? '✓' : '–'
    wrap.appendChild(badge)
  }
  return wrap
}

function stopPopupHtml(stop: FleetStop, tech: StopsTech): string {
  const status =
    stop.status === 'done'
      ? `✓ Done${stop.completed_at ? ` ${fmtChicagoTime(stop.completed_at)}` : ''}`
      : stop.status === 'skipped'
        ? '– Skipped'
        : stop.is_next
          ? 'Next stop'
          : ''
  return `
    <div style="font-family:system-ui;color:#111;min-width:170px;max-width:240px;font-size:12px">
      <div style="font-weight:600;font-size:13px">#${stop.n} · ${escapeHtml(stop.client_name)}</div>
      ${stop.services.length ? `<div style="color:#333;margin-top:2px">${stop.services.map(escapeHtml).join(', ')}</div>` : ''}
      <div style="color:#555;margin-top:3px">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${tech.color};margin-right:4px"></span>${escapeHtml(tech.name)}${stop.scheduled_start_at ? ` · ${fmtChicagoTime(stop.scheduled_start_at)}` : ''}
      </div>
      ${status ? `<div style="margin-top:3px;font-weight:600;color:${stop.status === 'done' ? '#15803d' : '#444'}">${status}</div>` : ''}
    </div>
  `
}

function stopSignature(stop: FleetStop, color: string): string {
  return [stop.n, stop.status, stop.is_next, color, stop.lat, stop.lng, stop.client_name, stop.services.join('|'), stop.completed_at].join('~')
}

const HIST_LINE_SOURCE = 'fleet-hist-line'
const HIST_PINGS_SOURCE = 'fleet-hist-pings'
const HIST_STOPS_SOURCE = 'fleet-hist-stops'
const HIST_LINE_LAYER = 'fleet-hist-line-layer'
const HIST_ARROWS_LAYER = 'fleet-hist-arrows-layer'
const HIST_PINGS_LAYER = 'fleet-hist-pings-layer'
const HIST_STOPS_LAYER = 'fleet-hist-stops-layer'

// Heroes' operating timezone — 'en-CA' formats as YYYY-MM-DD.
function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

function fmtChicagoTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return iso
  const min = Math.round(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  return `${day}d ago`
}

function buildMarkerEl(device: Device, hasAlert: boolean, driver: Driver | null): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.style.zIndex = '3' // trucks sit above the stop pins
  // NO inline `position` here: mapbox-gl positions markers via its
  // .mapboxgl-marker class (position:absolute + transform). An inline
  // position:relative overrides that class and drops the marker into normal
  // layout flow, offsetting every pin by a constant pixel amount — which
  // looks like "pins are miles off" when zoomed out. (The absolute-positioned
  // wrap still anchors the alert badge below.)
  wrap.style.width = '32px'
  wrap.style.height = '32px'

  const circle = document.createElement('div')
  circle.style.width = '32px'
  circle.style.height = '32px'
  circle.style.borderRadius = '50%'
  circle.style.background = statusColor(device.drive_status)
  circle.style.border = '2px solid white'
  circle.style.boxShadow = '0 2px 4px rgba(0,0,0,0.4)'
  circle.style.display = 'flex'
  circle.style.alignItems = 'center'
  circle.style.justifyContent = 'center'
  wrap.appendChild(circle)

  const arrow = document.createElement('div')
  arrow.style.width = '0'
  arrow.style.height = '0'
  arrow.style.borderLeft = '5px solid transparent'
  arrow.style.borderRight = '5px solid transparent'
  arrow.style.borderBottom = '10px solid white'
  arrow.style.transform = `rotate(${device.heading}deg)`
  arrow.style.transformOrigin = '50% 50%'
  circle.appendChild(arrow)

  if (hasAlert) {
    const badge = document.createElement('div')
    badge.style.position = 'absolute'
    badge.style.top = '-2px'
    badge.style.right = '-2px'
    badge.style.width = '12px'
    badge.style.height = '12px'
    badge.style.borderRadius = '50%'
    badge.style.background = '#ef4444'
    badge.style.border = '2px solid white'
    wrap.appendChild(badge)
  }

  if (driver) {
    // The tech's name under the truck, in their map colour.
    const label = document.createElement('div')
    label.style.position = 'absolute'
    label.style.top = '34px'
    label.style.left = '50%'
    label.style.transform = 'translateX(-50%)'
    label.style.whiteSpace = 'nowrap'
    label.style.padding = '1px 6px'
    label.style.borderRadius = '9999px'
    label.style.font = '600 11px/1.4 system-ui, sans-serif'
    label.style.color = 'white'
    label.style.background = driver.color ?? '#111827'
    label.style.border = '1px solid rgba(255,255,255,0.8)'
    label.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)'
    label.textContent = driver.name
    wrap.appendChild(label)
  }

  return wrap
}

export default function FleetPage() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const mapboxglRef = useRef<MapboxModule | null>(null)
  const markersRef = useRef<Map<string, MapboxMarker>>(new Map())
  const fittedRef = useRef(false)

  const [devices, setDevices] = useState<Device[]>([])
  const [alerts, setAlerts] = useState<AlertEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Map-engine load/init failure (e.g. WebGL unavailable on this device). Kept
  // separate from `error` (data-fetch errors) so the map can fail gracefully
  // while the vehicle sidebar — which needs no WebGL — keeps working.
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)

  // Day History state
  const histPopupRef = useRef<MapboxPopup | null>(null)
  const histHandlersRef = useRef(false)
  const [histDevice, setHistDevice] = useState('')
  const [histDate, setHistDate] = useState(chicagoToday)
  const [histLoading, setHistLoading] = useState(false)
  const [histError, setHistError] = useState<string | null>(null)
  const [hist, setHist] = useState<DayHistory | null>(null)

  // Work Order stops — for the same day as Day History (shared date picker).
  const stopMarkersRef = useRef<Map<string, { marker: MapboxMarker; sig: string }>>(new Map())
  const stopsDateRef = useRef(histDate)
  const refitStopsRef = useRef(false)
  const [stopsDay, setStopsDay] = useState<StopsDay | null>(null)
  const [stopsLoaded, setStopsLoaded] = useState(false)
  const [stopsError, setStopsError] = useState<string | null>(null)
  const [showStops, setShowStops] = useState(true)
  const [techFilter, setTechFilter] = useState('')
  // The trucks on the map are always live, so they carry TODAY's drivers — kept
  // apart from stopsDay so picking a past day doesn't relabel the live trucks.
  const [todayDrivers, setTodayDrivers] = useState<Driver[]>([])

  const driverByDevice = useMemo(() => {
    const m = new Map<string, Driver>()
    for (const d of todayDrivers) m.set(d.device_id, d)
    return m
  }, [todayDrivers])

  const deviceName = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of devices) m.set(d.id, d.name)
    return m
  }, [devices])

  // Map of device_id → list of open alert types
  const alertsByDevice = useMemo(() => {
    const m = new Map<string, AlertEvent[]>()
    for (const a of alerts) {
      const arr = m.get(a.device_id) ?? []
      arr.push(a)
      m.set(a.device_id, arr)
    }
    return m
  }, [alerts])

  // Initial map setup — lazy-load mapbox-gl, then construct the map inside a
  // try/catch. `new Map()` throws synchronously when WebGL can't initialize
  // (hardware acceleration off, GPU blocklisted, remote session); catching it
  // shows a friendly "map unavailable" panel instead of crashing the whole
  // Fleet page (the throw used to propagate to the Hub error boundary).
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return
    if (!MAPBOX_TOKEN) {
      setMapError('Mapbox token not configured')
      return
    }

    let cancelled = false
    let cleanup: (() => void) | null = null

    ;(async () => {
      try {
        const mapboxgl = (await import('mapbox-gl')).default
        if (cancelled || !mapContainerRef.current) return
        mapboxglRef.current = mapboxgl

        mapboxgl.accessToken = MAPBOX_TOKEN
        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [-95.45, 30.27], // The Woodlands, TX-ish
          zoom: 10,
        })
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
        mapRef.current = map
        setMapError(null)
        // A ref write doesn't re-render — flip state so the markers effect
        // re-runs now that the (async) map actually exists.
        setMapReady(true)

        // Mapbox locks in the container's pixel dimensions at construct time and
        // doesn't react to flex/grid layout shifts on its own. Hammer resize
        // across a handful of frames in case the layout settles late, then keep
        // observing the container for any future change (sidebar collapse,
        // device rotation).
        const container = mapContainerRef.current
        const ro = new ResizeObserver(() => map.resize())
        ro.observe(container)
        const resizeTimers: number[] = []
        ;[0, 50, 200, 500, 1000].forEach((ms) => {
          resizeTimers.push(window.setTimeout(() => map.resize(), ms))
        })
        cleanup = () => {
          resizeTimers.forEach((t) => window.clearTimeout(t))
          ro.disconnect()
        }
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        setMapError(
          /webgl/i.test(msg)
            ? 'Map unavailable on this device — your browser can’t start WebGL. Try enabling hardware acceleration (chrome://settings/system), or view the vehicle list below.'
            : `Map failed to load: ${msg}`,
        )
      }
    })()

    return () => {
      cancelled = true
      cleanup?.()
      mapRef.current?.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // Render / update markers when devices or alerts change (or once the map is
  // ready — mapReady gates so this re-runs after the async map init).
  useEffect(() => {
    const map = mapRef.current
    const mapboxgl = mapboxglRef.current
    if (!map || !mapboxgl || !mapReady) return
    const seen = new Set<string>()
    for (const dev of devices) {
      seen.add(dev.id)
      const hasAlert = (alertsByDevice.get(dev.id)?.length ?? 0) > 0
      const driver = driverByDevice.get(dev.id) ?? null
      // Rebuild the marker every tick so heading rotation, status color,
      // and alert badges all stay in sync without manually patching DOM nodes.
      markersRef.current.get(dev.id)?.remove()
      const marker = new mapboxgl.Marker({ element: buildMarkerEl(dev, hasAlert, driver) })
        .setLngLat([dev.lng, dev.lat])
        .setPopup(buildPopup(mapboxgl, dev, alertsByDevice.get(dev.id) ?? [], driver))
        .addTo(map)
      markersRef.current.set(dev.id, marker)
    }
    // Clean up markers for vehicles that have disappeared
    for (const [id, marker] of markersRef.current.entries()) {
      if (!seen.has(id)) {
        marker.remove()
        markersRef.current.delete(id)
      }
    }
  }, [devices, alertsByDevice, driverByDevice, mapReady])

  // On first load, fit the view to every truck AND today's stops — once both
  // requests have answered (a failed stops call still counts as answered).
  useEffect(() => {
    const map = mapRef.current
    const mapboxgl = mapboxglRef.current
    if (!map || !mapboxgl || !mapReady || fittedRef.current) return
    if (devices.length === 0 || !stopsLoaded) return
    const bounds = new mapboxgl.LngLatBounds()
    for (const d of devices) bounds.extend([d.lng, d.lat])
    for (const t of stopsDay?.techs ?? []) for (const s of t.stops) bounds.extend([s.lng, s.lat])
    map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 0 })
    fittedRef.current = true
  }, [devices, stopsDay, stopsLoaded, mapReady])

  // Draw the stop pins. Markers are kept between polls and rebuilt only when
  // something about the stop changed, so an open hover card survives a refresh.
  useEffect(() => {
    const map = mapRef.current
    const mapboxgl = mapboxglRef.current
    if (!map || !mapboxgl || !mapReady) return
    const live = stopMarkersRef.current
    const seen = new Set<string>()
    if (showStops) {
      for (const tech of stopsDay?.techs ?? []) {
        if (techFilter && tech.user_id !== techFilter) continue
        for (const stop of tech.stops) {
          seen.add(stop.id)
          const sig = stopSignature(stop, tech.color) + `~${tech.name}`
          const existing = live.get(stop.id)
          if (existing?.sig === sig) continue
          existing?.marker.remove()
          const el = buildStopEl(stop, tech.color)
          const popup = new mapboxgl.Popup({ offset: 14, closeButton: false, maxWidth: '260px' })
            .setHTML(stopPopupHtml(stop, tech))
          const marker = new mapboxgl.Marker({ element: el })
            .setLngLat([stop.lng, stop.lat])
            .setPopup(popup) // tap / click toggles it
            .addTo(map)
          // Desktop: show on hover. Mouse only — a tap fires pointerenter too and
          // would open-then-toggle-closed.
          el.addEventListener('pointerenter', (e) => {
            if (e.pointerType === 'mouse' && !popup.isOpen()) marker.togglePopup()
          })
          el.addEventListener('pointerleave', (e) => {
            if (e.pointerType === 'mouse' && popup.isOpen()) marker.togglePopup()
          })
          live.set(stop.id, { marker, sig })
        }
      }
    }
    for (const [id, entry] of live.entries()) {
      if (!seen.has(id)) {
        entry.marker.remove()
        live.delete(id)
      }
    }

    // After the person picks a different day, frame that day's stops.
    if (refitStopsRef.current && stopsDay && stopsDay.date === stopsDateRef.current) {
      refitStopsRef.current = false
      const pts = (stopsDay.techs ?? [])
        .filter((t) => !techFilter || t.user_id === techFilter)
        .flatMap((t) => t.stops)
      if (pts.length > 0) {
        const bounds = new mapboxgl.LngLatBounds()
        for (const s of pts) bounds.extend([s.lng, s.lat])
        map.fitBounds(bounds, { padding: 70, maxZoom: 14 })
      }
    }
  }, [stopsDay, showStops, techFilter, mapReady])

  async function fetchStops(date: string) {
    try {
      const res = await fetch(`/api/fleet/stops?date=${date}`, { cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as (StopsDay & { error?: string }) | null
      if (!res.ok) throw new Error(body?.error ?? `stops ${res.status}`)
      if (date === chicagoToday()) setTodayDrivers(body?.drivers ?? [])
      // Ignore an answer for a day the person has already moved off.
      if (date !== stopsDateRef.current) return
      const techs = body?.techs ?? []
      setStopsDay({ date, techs, drivers: body?.drivers ?? [] })
      // A picked tech with no route this day would hide every pin — fall back to everyone.
      setTechFilter((f) => (f && !techs.some((t) => t.user_id === f) ? '' : f))
      setStopsError(null)
    } catch (err) {
      if (date !== stopsDateRef.current) return
      setStopsError(err instanceof Error ? err.message : String(err))
    } finally {
      setStopsLoaded(true)
    }
  }

  // The stops follow the Day History date.
  useEffect(() => {
    if (stopsDateRef.current === histDate) return
    stopsDateRef.current = histDate
    refitStopsRef.current = true
    setStopsDay(null)
    void fetchStops(histDate)
  }, [histDate])

  async function loadHistory() {
    if (!histDevice) return
    setHistLoading(true)
    setHistError(null)
    try {
      const res = await fetch(
        `/api/fleet/history?device_id=${encodeURIComponent(histDevice)}&date=${histDate}`,
        { cache: 'no-store' },
      )
      const body = (await res.json().catch(() => null)) as
        | (Partial<DayHistory> & { error?: string })
        | null
      if (!res.ok) throw new Error(body?.error ?? `history ${res.status}`)
      setHist({ points: body?.points ?? [], stops: body?.stops ?? [] })
    } catch (err) {
      setHistError(err instanceof Error ? err.message : String(err))
      setHist(null)
    } finally {
      setHistLoading(false)
    }
  }

  function clearHistory() {
    setHist(null)
    setHistError(null)
  }

  // Draw / clear the Day History path layers whenever the loaded history
  // changes. Layers need the map STYLE loaded (unlike DOM markers), so fall
  // back to the map's 'load' event when it hasn't finished yet.
  useEffect(() => {
    const map = mapRef.current
    const mapboxgl = mapboxglRef.current
    if (!map || !mapboxgl || !mapReady) return

    const draw = () => {
      histPopupRef.current?.remove()
      histPopupRef.current = null

      if (!hist) {
        for (const layer of [HIST_STOPS_LAYER, HIST_PINGS_LAYER, HIST_ARROWS_LAYER, HIST_LINE_LAYER]) {
          if (map.getLayer(layer)) map.removeLayer(layer)
        }
        for (const source of [HIST_STOPS_SOURCE, HIST_PINGS_SOURCE, HIST_LINE_SOURCE]) {
          if (map.getSource(source)) map.removeSource(source)
        }
        return
      }

      const line: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: hist.points.map((p) => [p.lng, p.lat]) },
        properties: {},
      }
      const pings: GeoJSON.FeatureCollection<GeoJSON.Point> = {
        type: 'FeatureCollection',
        features: hist.points.map((p) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: { t: p.t, speed: p.speed_mph, status: statusLabel(p.drive_status) },
        })),
      }
      const stops: GeoJSON.FeatureCollection<GeoJSON.Point> = {
        type: 'FeatureCollection',
        features: hist.stops.map((s) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
          properties: { start: s.start, end: s.end, minutes: s.minutes },
        })),
      }

      const upsert = (id: string, data: GeoJSON.Feature | GeoJSON.FeatureCollection) => {
        const src = map.getSource(id) as GeoJSONSource | undefined
        if (src) src.setData(data)
        else map.addSource(id, { type: 'geojson', data })
      }
      upsert(HIST_LINE_SOURCE, line)
      upsert(HIST_PINGS_SOURCE, pings)
      upsert(HIST_STOPS_SOURCE, stops)

      if (!map.getLayer(HIST_LINE_LAYER)) {
        map.addLayer({
          id: HIST_LINE_LAYER,
          type: 'line',
          source: HIST_LINE_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          // dasharray [0, 2] + round caps renders as a dotted line
          paint: { 'line-color': '#2563eb', 'line-width': 2.5, 'line-dasharray': [0, 2] },
        })
      }
      if (!map.getLayer(HIST_PINGS_LAYER)) {
        map.addLayer({
          id: HIST_PINGS_LAYER,
          type: 'circle',
          source: HIST_PINGS_SOURCE,
          paint: {
            'circle-radius': 4,
            'circle-color': '#2563eb',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          },
        })
      }
      // Direction-of-travel arrows along the path. The line's coordinates are
      // chronological, so line direction = direction of movement. The arrow is
      // a canvas-drawn image (a font glyph like '▶' can silently render as
      // nothing if the style's glyph fetch fails), and this layer sits ABOVE
      // the ping dots — on a dense day the overlapping ping circles form a
      // solid rope that buries anything drawn beneath them.
      if (!map.hasImage('fleet-hist-arrow')) {
        const size = 44 // drawn at 2x, rendered at pixelRatio 2 → crisp ~22px base
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (ctx) {
          // Right-pointing solid arrow with a white outline for contrast
          ctx.beginPath()
          ctx.moveTo(8, 8)
          ctx.lineTo(38, 22)
          ctx.lineTo(8, 36)
          ctx.closePath()
          ctx.fillStyle = '#1d4ed8'
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 4
          ctx.lineJoin = 'round'
          ctx.stroke()
          ctx.fill()
          map.addImage(
            'fleet-hist-arrow',
            ctx.getImageData(0, 0, size, size),
            { pixelRatio: 2 },
          )
        }
      }
      if (!map.getLayer(HIST_ARROWS_LAYER) && map.hasImage('fleet-hist-arrow')) {
        map.addLayer({
          id: HIST_ARROWS_LAYER,
          type: 'symbol',
          source: HIST_LINE_SOURCE,
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 100,
            'icon-image': 'fleet-hist-arrow',
            'icon-size': 0.6,
            // Rotate with the line on the map (direction of travel), always
            // visible, and out of the street-label collision game.
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        })
      }
      if (!map.getLayer(HIST_STOPS_LAYER)) {
        map.addLayer({
          id: HIST_STOPS_LAYER,
          type: 'circle',
          source: HIST_STOPS_SOURCE,
          paint: {
            'circle-radius': 10,
            'circle-color': '#f97316',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        })
      }

      // Click → timestamp popups. Registered once per map instance.
      if (!histHandlersRef.current) {
        histHandlersRef.current = true
        map.on('click', HIST_STOPS_LAYER, (e) => {
          const f = e.features?.[0]
          if (!f) return
          const props = f.properties as { start?: string; end?: string; minutes?: number }
          histPopupRef.current?.remove()
          histPopupRef.current = new mapboxgl.Popup({ offset: 12 })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font-family:system-ui;color:#111;font-size:12px">
                <div style="font-weight:600">⏱ Stopped ${Number(props.minutes ?? 0)} min</div>
                <div style="color:#444;margin-top:2px">${props.start ? fmtChicagoTime(props.start) : ''} – ${props.end ? fmtChicagoTime(props.end) : ''}</div>
              </div>`,
            )
            .addTo(map)
        })
        map.on('click', HIST_PINGS_LAYER, (e) => {
          // A stop dot sits on top of its own pings — let the stop popup win.
          if (map.getLayer(HIST_STOPS_LAYER)) {
            const stopsHit = map.queryRenderedFeatures(e.point, { layers: [HIST_STOPS_LAYER] })
            if (stopsHit.length > 0) return
          }
          const f = e.features?.[0]
          if (!f) return
          const props = f.properties as { t?: string; speed?: number; status?: string }
          histPopupRef.current?.remove()
          histPopupRef.current = new mapboxgl.Popup({ offset: 8 })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font-family:system-ui;color:#111;font-size:12px">
                <div style="font-weight:600">${props.t ? fmtChicagoTime(props.t) : ''}</div>
                <div style="color:#444;margin-top:2px">${Number(props.speed ?? 0)} mph · ${escapeHtml(String(props.status ?? ''))}</div>
              </div>`,
            )
            .addTo(map)
        })
        for (const layer of [HIST_PINGS_LAYER, HIST_STOPS_LAYER]) {
          map.on('mouseenter', layer, () => {
            map.getCanvas().style.cursor = 'pointer'
          })
          map.on('mouseleave', layer, () => {
            map.getCanvas().style.cursor = ''
          })
        }
      }

      // Fit the whole day's path in view
      if (hist.points.length > 0) {
        const bounds = new mapboxgl.LngLatBounds()
        for (const p of hist.points) bounds.extend([p.lng, p.lat])
        map.fitBounds(bounds, { padding: 60, maxZoom: 15 })
      }
    }

    if (map.isStyleLoaded()) {
      draw()
      return
    }
    // NOT map.once('load', …): 'load' fires exactly once per map lifetime, so
    // if the style is merely mid-repaint (isStyleLoaded() is transiently false
    // — e.g. tiles still streaming in when the user clicks Show path) a 'load'
    // listener never fires and nothing draws until the next click. 'idle'
    // re-fires every time the map settles.
    map.once('idle', draw)
    return () => {
      map.off('idle', draw)
    }
  }, [hist, mapReady])

  // Poll devices + alerts
  useEffect(() => {
    let cancelled = false
    async function tick() {
      // Don't poll the (paid) GPS API while the tab/app is hidden — it resumes
      // immediately via the visibilitychange listener below.
      if (typeof document !== 'undefined' && document.hidden) return
      // Stops refresh with the trucks (our own DB, not the GPS API).
      void fetchStops(stopsDateRef.current)
      try {
        const [devRes, evRes] = await Promise.all([
          fetch('/api/fleet/devices', { cache: 'no-store' }),
          fetch('/api/fleet/alert-events', { cache: 'no-store' }),
        ])
        if (cancelled) return
        if (!devRes.ok) {
          const body = await devRes.json().catch(() => null)
          setError(body?.error ?? `devices ${devRes.status}`)
          setLoading(false)
          return
        }
        const devBody = (await devRes.json()) as { devices: Device[] }
        setDevices(devBody.devices ?? [])
        setError(null)
        if (evRes.ok) {
          const evBody = (await evRes.json()) as { events: AlertEvent[] }
          setAlerts(evBody.events ?? [])
        }
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    }
    tick()
    const id = setInterval(tick, POLL_INTERVAL_MS)
    const onVisible = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return (
    <div className="flex flex-col md:flex-row flex-1 min-h-0 w-full bg-gray-950 text-white">
      <div className="relative flex-1 min-h-[50vh] md:min-h-0 md:h-full">
        <div ref={mapContainerRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        {mapError && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950 p-6">
            <div className="max-w-sm text-center">
              <div className="text-3xl mb-3">🗺️</div>
              <div className="text-sm text-white/80">{mapError}</div>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute top-4 left-4 right-4 md:right-auto md:max-w-md bg-red-900/80 border border-red-700 text-red-100 px-3 py-2 rounded text-sm">
            {error}
          </div>
        )}
        {loading && !error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-gray-900/80 px-3 py-1 rounded text-sm">
            Loading vehicles…
          </div>
        )}
      </div>
      <div className="w-full md:w-80 md:border-l border-t md:border-t-0 border-white/10 overflow-y-auto p-3 space-y-2">
        <div className="rounded-lg border border-white/10 bg-white/5 p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-white/70">Stops</h2>
            <label className="flex items-center gap-1.5 text-xs text-white/70 cursor-pointer">
              <input
                type="checkbox"
                checked={showStops}
                onChange={(e) => setShowStops(e.target.checked)}
                className="accent-sky-500"
              />
              Show on map
            </label>
          </div>
          <div className="flex gap-2">
            <select
              value={techFilter}
              onChange={(e) => setTechFilter(e.target.value)}
              disabled={!showStops}
              className="flex-1 min-w-0 bg-gray-900 text-white border border-white/10 rounded px-2 py-1.5 text-base md:text-sm disabled:opacity-40"
            >
              <option value="">Everyone</option>
              {(stopsDay?.techs ?? []).map((t) => (
                <option key={t.user_id} value={t.user_id}>
                  {t.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={histDate}
              max={chicagoToday()}
              onChange={(e) => e.target.value && setHistDate(e.target.value)}
              aria-label="Day"
              className="bg-gray-900 text-white border border-white/10 rounded px-2 py-1.5 text-base md:text-sm [color-scheme:dark]"
            />
          </div>
          {stopsError && <div className="text-xs text-red-300">{stopsError}</div>}
          {stopsDay && stopsDay.techs.length === 0 && (
            <div className="text-xs text-white/50">No Work Order stops for this day.</div>
          )}
          {stopsDay && stopsDay.techs.length > 0 && (
            <div className="space-y-1">
              {stopsDay.techs.map((t) => {
                const truck = t.device_id ? deviceName.get(t.device_id) : null
                const unmapped = t.total - t.stops.length
                return (
                  <button
                    key={t.user_id}
                    type="button"
                    onClick={() => setTechFilter(techFilter === t.user_id ? '' : t.user_id)}
                    className={`w-full flex items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-white/10 ${
                      techFilter === t.user_id ? 'bg-white/10' : ''
                    }`}
                  >
                    <span className="w-3 h-3 rounded-full shrink-0 border border-white/70" style={{ background: t.color }} />
                    <span className="min-w-0">
                      <span className="block font-medium text-white/90 truncate">{t.name}</span>
                      <span className="block text-white/40 truncate">{truck ?? 'No truck linked'}</span>
                    </span>
                    <span className="ml-auto text-white/50 shrink-0 text-right">
                      {t.total} stop{t.total === 1 ? '' : 's'}
                      {unmapped > 0 && <span className="block">{unmapped} not on map</span>}
                    </span>
                  </button>
                )
              })}
              <div className="text-[11px] text-white/40 pt-0.5">
                Numbers are route order · grey ✓ = done (here or in Jobber) · – = skipped · ring = next stop
              </div>
            </div>
          )}
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-white/70">Day History</h2>
            {hist && (
              <button onClick={clearHistory} className="text-xs text-sky-300 hover:text-sky-200">
                ✕ Back to live
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <select
              value={histDevice}
              onChange={(e) => setHistDevice(e.target.value)}
              className="flex-1 min-w-0 bg-gray-900 text-white border border-white/10 rounded px-2 py-1.5 text-base md:text-sm"
            >
              <option value="">Vehicle…</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={histDate}
              max={chicagoToday()}
              onChange={(e) => setHistDate(e.target.value)}
              className="bg-gray-900 text-white border border-white/10 rounded px-2 py-1.5 text-base md:text-sm [color-scheme:dark]"
            />
          </div>
          <button
            onClick={loadHistory}
            disabled={!histDevice || histLoading}
            className="w-full bg-sky-600 hover:bg-sky-500 disabled:opacity-40 rounded py-1.5 text-sm font-medium"
          >
            {histLoading ? 'Loading…' : 'Show path'}
          </button>
          {histError && <div className="text-xs text-red-300">{histError}</div>}
          {hist && !histLoading && (
            <div className="text-xs text-white/60">
              {hist.points.length === 0
                ? 'No GPS data for this day.'
                : `${hist.points.length} pings · ${hist.stops.length} stop${hist.stops.length === 1 ? '' : 's'} ≥ 10 min — tap a dot for its time`}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/70">Vehicles</h2>
          <span className="text-xs text-white/40">refresh 30s</span>
        </div>
        {devices.length === 0 && !loading && !error && (
          <div className="text-sm text-white/60">No vehicles reporting.</div>
        )}
        {devices.map((d) => {
          const devAlerts = alertsByDevice.get(d.id) ?? []
          return (
            <div
              key={d.id}
              className="rounded-lg border border-white/10 bg-white/5 p-2.5 hover:bg-white/10 transition-colors cursor-pointer"
              onClick={() => {
                const m = markersRef.current.get(d.id)
                if (m) {
                  mapRef.current?.flyTo({ center: [d.lng, d.lat], zoom: 14 })
                  m.togglePopup()
                }
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{d.name}</div>
                  {driverByDevice.get(d.id) && (
                    <div className="text-xs text-white/60 truncate">
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                        style={{ background: driverByDevice.get(d.id)?.color ?? '#9ca3af' }}
                      />
                      {driverByDevice.get(d.id)?.name}
                    </div>
                  )}
                </div>
                <span
                  className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{ background: statusColor(d.drive_status), color: 'white' }}
                >
                  {statusLabel(d.drive_status)}
                </span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-2 text-xs text-white/70">
                <div>{d.speed_mph} mph</div>
                <div>{d.fuel_pct == null ? '—' : `${d.fuel_pct}% fuel`}</div>
                <div className="col-span-2 text-white/40">Ping {relativeTime(d.last_ping)}</div>
              </div>
              {devAlerts.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {devAlerts.map((a) => (
                    <div key={a.id} className="text-[11px] text-red-300">
                      {alertLabel(a.alert_type)} — since {relativeTime(a.started_at)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function buildPopup(mapboxgl: MapboxModule, device: Device, alerts: AlertEvent[], driver: Driver | null): MapboxPopup {
  const popup = new mapboxgl.Popup({ offset: 18, closeButton: true })
  const alertHtml =
    alerts.length === 0
      ? ''
      : `<div style="margin-top:6px;color:#fca5a5;font-size:11px">${alerts
          .map((a) => `${alertLabel(a.alert_type)}`)
          .join('<br/>')}</div>`
  popup.setHTML(`
    <div style="font-family:system-ui;color:#111;min-width:160px">
      <div style="font-weight:600">${escapeHtml(device.name)}</div>
      ${driver ? `<div style="font-size:12px;color:#222">Driver: ${escapeHtml(driver.name)}</div>` : ''}
      <div style="font-size:12px;color:#444;margin-top:2px">${statusLabel(device.drive_status)} · ${device.speed_mph} mph</div>
      <div style="font-size:12px;color:#444">Fuel: ${device.fuel_pct == null ? '—' : device.fuel_pct + '%'}</div>
      <div style="font-size:11px;color:#888;margin-top:2px">Ping ${relativeTime(device.last_ping)}</div>
      ${alertHtml}
    </div>
  `)
  return popup
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
