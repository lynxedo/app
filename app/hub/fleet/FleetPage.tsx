'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Map as MapboxMap, Marker as MapboxMarker, Popup as MapboxPopup } from 'mapbox-gl'

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
  drive_status: 'driving' | 'stopped' | 'off' | 'being_towed' | 'parked' | 'unknown'
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
    case 'driving': return '#22c55e'
    case 'stopped': return '#eab308'
    case 'parked':  return '#eab308'
    case 'being_towed': return '#f97316'
    case 'off':
    case 'unknown':
    default:        return '#6b7280'
  }
}

function statusLabel(status: Device['drive_status']): string {
  switch (status) {
    case 'driving': return 'Driving'
    case 'stopped': return 'Stopped'
    case 'parked':  return 'Parked'
    case 'being_towed': return 'Being towed'
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

function buildMarkerEl(device: Device, hasAlert: boolean): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.style.position = 'relative'
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
          style: 'mapbox://styles/mapbox/dark-v11',
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
      // Rebuild the marker every tick so heading rotation, status color,
      // and alert badges all stay in sync without manually patching DOM nodes.
      markersRef.current.get(dev.id)?.remove()
      const marker = new mapboxgl.Marker({ element: buildMarkerEl(dev, hasAlert) })
        .setLngLat([dev.lng, dev.lat])
        .setPopup(buildPopup(mapboxgl, dev, alertsByDevice.get(dev.id) ?? []))
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
    // On first non-empty load, fit bounds to all vehicles
    if (!fittedRef.current && devices.length > 0) {
      const bounds = new mapboxgl.LngLatBounds()
      for (const d of devices) bounds.extend([d.lng, d.lat])
      map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 0 })
      fittedRef.current = true
    }
  }, [devices, alertsByDevice, mapReady])

  // Poll devices + alerts
  useEffect(() => {
    let cancelled = false
    async function tick() {
      // Don't poll the (paid) GPS API while the tab/app is hidden — it resumes
      // immediately via the visibilitychange listener below.
      if (typeof document !== 'undefined' && document.hidden) return
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
                <div className="font-medium">{d.name}</div>
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

function buildPopup(mapboxgl: MapboxModule, device: Device, alerts: AlertEvent[]): MapboxPopup {
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
