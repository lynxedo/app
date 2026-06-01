'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Map as MapboxMap, Marker as MapboxMarker, Popup as MapboxPopup, GeoJSONSource } from 'mapbox-gl'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

// A pin on the Advanced map. Unlike the Basic RoutePreviewPin this carries
// selection/dim state and richer popup fields, because Advanced is interactive
// (click to inspect, lasso to select) rather than a static preview.
export interface AdvPin {
  id: string
  lat: number
  lng: number
  label: string        // text inside the pin ("" → small dot; "1".."n"/"a".. → numbered route order)
  color: string        // hex without # (e.g. "e47200")
  selected: boolean    // currently in the lasso/checkbox selection
  dimmed: boolean      // not part of the active optimized route — shown faint
  title?: string       // client name (popup heading)
  subtitle?: string    // address (popup line 2)
  meta?: string        // time / service (popup line 3)
}

interface AdvancedRouteMapProps {
  depotCoord: { lat: number; lng: number } | null
  pins: AdvPin[]
  /**
   * Ordered coords (depot → optimized stops → depot) for the driving polyline.
   * When null, no path is drawn. Pins are independent of this — the path only
   * appears after "Optimize Selected".
   */
  pathCoords: Array<{ lat: number; lng: number }> | null
  onLassoSelect: (ids: string[]) => void
  onPinClick: (id: string) => void
  /** When set, the map eases to that pin and opens its popup. */
  highlightId: string | null
  height?: number
}

// In-process cache: ordered coord-string → driving LineString. Mirrors the
// Basic preview map so repeated optimizes of the same set are free.
const directionsCache = new Map<string, GeoJSON.Feature<GeoJSON.LineString>>()

function coordsKey(pts: Array<{ lat: number; lng: number }>): string {
  return pts.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
}

async function fetchDirections(
  pts: Array<{ lat: number; lng: number }>,
  token: string,
  signal?: AbortSignal,
): Promise<GeoJSON.Feature<GeoJSON.LineString> | null> {
  if (pts.length < 2 || pts.length > 25) return null
  const key = coordsKey(pts)
  const cached = directionsCache.get(key)
  if (cached) return cached
  const coordStr = pts.map(p => `${p.lng},${p.lat}`).join(';')
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}` +
    `?geometries=geojson&overview=full&access_token=${token}`
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const data = await res.json() as { code: string; routes?: Array<{ geometry: GeoJSON.LineString }> }
    if (data.code !== 'Ok' || !data.routes?.[0]?.geometry) return null
    const feature: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature', properties: {}, geometry: data.routes[0].geometry,
    }
    directionsCache.set(key, feature)
    return feature
  } catch {
    return null
  }
}

function straightLineFeature(pts: Array<{ lat: number; lng: number }>): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: pts.map(p => [p.lng, p.lat]) },
  }
}

// Standard ray-casting point-in-polygon, run in container-pixel space so map
// projection distortion never affects the lasso hit-test.
function pointInPolygon(pt: { x: number; y: number }, poly: Array<{ x: number; y: number }>): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y
    const intersect = ((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function buildPinEl(pin: AdvPin): HTMLDivElement {
  const el = document.createElement('div')
  const size = pin.label ? 28 : pin.selected ? 18 : 14
  el.style.width = `${size}px`
  el.style.height = `${size}px`
  el.style.borderRadius = '50%'
  el.style.background = `#${pin.color}`
  el.style.border = pin.selected ? '3px solid #fff' : '2px solid #fff'
  el.style.boxShadow = pin.selected
    ? '0 0 0 2px #f97316, 0 1px 5px rgba(0,0,0,0.55)'
    : '0 1px 4px rgba(0,0,0,0.5)'
  el.style.color = '#fff'
  el.style.fontSize = '12px'
  el.style.fontWeight = 'bold'
  el.style.display = 'flex'
  el.style.alignItems = 'center'
  el.style.justifyContent = 'center'
  el.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
  el.style.cursor = 'pointer'
  el.style.opacity = pin.dimmed ? '0.35' : '1'
  el.style.transition = 'opacity 0.15s'
  el.textContent = pin.label
  if (pin.title) el.title = pin.title
  return el
}

function popupHtml(pin: AdvPin): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c
  ))
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;min-width:160px">
      <div style="font-weight:700;font-size:13px;color:#0f172a">${esc(pin.title ?? 'Stop')}</div>
      ${pin.subtitle ? `<div style="font-size:12px;color:#475569;margin-top:2px">${esc(pin.subtitle)}</div>` : ''}
      ${pin.meta ? `<div style="font-size:11px;color:#ea580c;margin-top:3px">${esc(pin.meta)}</div>` : ''}
    </div>`
}

export default function AdvancedRouteMap({
  depotCoord,
  pins,
  pathCoords,
  onLassoSelect,
  onPinClick,
  highlightId,
  height = 600,
}: AdvancedRouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const markersRef = useRef<MapboxMarker[]>([])
  const popupRef = useRef<MapboxPopup | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [pathFallback, setPathFallback] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Lasso state. Points are in container-pixel space (overlay covers the map
  // canvas 1:1, so map.project() coords share the same origin).
  const [lassoActive, setLassoActive] = useState(false)
  const [lassoPts, setLassoPts] = useState<Array<{ x: number; y: number }>>([])
  const drawingRef = useRef(false)

  // Keep the latest pins in a ref so the lasso pointer handlers (created once
  // per render but capturing closures) always hit-test against current data.
  const pinsRef = useRef<AdvPin[]>(pins)
  pinsRef.current = pins
  // Latest onPinClick in a ref so the marker-render effect doesn't depend on the
  // parent passing a stable callback — markers then rebuild only when the pin
  // set actually changes, not on every unrelated parent re-render (e.g. typing
  // a new date), which would otherwise tear down + re-add ~80 DOM markers.
  const onPinClickRef = useRef(onPinClick)
  onPinClickRef.current = onPinClick

  const orderedPathCoords = useMemo(() => {
    if (!pathCoords || pathCoords.length < 2) return null
    return pathCoords
  }, [pathCoords])

  // ── Initial map setup (lazy import — mapbox-gl is browser-only) ────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    if (!MAPBOX_TOKEN) { setLoadError('Mapbox token not configured'); return }

    let cancelled = false
    let cleanupResize: (() => void) | null = null

    ;(async () => {
      try {
        const mapboxgl = (await import('mapbox-gl')).default
        if (cancelled || !containerRef.current) return
        mapboxgl.accessToken = MAPBOX_TOKEN
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [-95.45, 30.27],
          zoom: 10,
        })
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
        map.addControl(new mapboxgl.FullscreenControl(), 'top-right')
        map.on('load', () => {
          map.addSource('route-path', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
          map.addLayer({
            id: 'route-path-line', type: 'line', source: 'route-path',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#1f77b4', 'line-width': 4, 'line-opacity': 0.85 },
          })
          setMapReady(true)
        })
        popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, offset: 16 })
        mapRef.current = map

        const container = containerRef.current
        const ro = new ResizeObserver(() => map.resize())
        ro.observe(container)
        const timers: number[] = []
        ;[0, 50, 200, 500, 1000].forEach(ms => timers.push(window.setTimeout(() => map.resize(), ms)))
        cleanupResize = () => { timers.forEach(t => window.clearTimeout(t)); ro.disconnect() }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Map failed to load')
      }
    })()

    return () => {
      cancelled = true
      cleanupResize?.()
      popupRef.current?.remove()
      mapRef.current?.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // ── Render pins (depot + visits) ──────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    let cancelled = false

    ;(async () => {
      const mapboxgl = (await import('mapbox-gl')).default
      if (cancelled || !mapRef.current) return

      for (const m of markersRef.current) m.remove()
      markersRef.current = []

      if (depotCoord) {
        const el = buildPinEl({
          id: '__depot__', lat: depotCoord.lat, lng: depotCoord.lng,
          label: 'D', color: '16a34a', selected: false, dimmed: false, title: 'Depot',
        })
        const m = new mapboxgl.Marker({ element: el })
          .setLngLat([depotCoord.lng, depotCoord.lat]).addTo(map)
        markersRef.current.push(m)
      }

      for (const pin of pins) {
        const el = buildPinEl(pin)
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          onPinClickRef.current(pin.id)
          const popup = popupRef.current
          if (popup && mapRef.current) {
            popup.setLngLat([pin.lng, pin.lat]).setHTML(popupHtml(pin)).addTo(mapRef.current)
          }
        })
        const m = new mapboxgl.Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(map)
        markersRef.current.push(m)
      }
    })()

    return () => { cancelled = true }
  }, [depotCoord, pins, mapReady])

  // ── Fit bounds when the set of locations changes (not on every selection) ──
  const fitKey = useMemo(
    () => [depotCoord ? `${depotCoord.lat},${depotCoord.lng}` : 'nd', ...pins.map(p => p.id)].join('|'),
    [depotCoord, pins],
  )
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    let cancelled = false
    ;(async () => {
      const mapboxgl = (await import('mapbox-gl')).default
      if (cancelled || !mapRef.current) return
      const allPts = [...(depotCoord ? [depotCoord] : []), ...pins.map(p => ({ lat: p.lat, lng: p.lng }))]
      if (allPts.length === 1) {
        map.easeTo({ center: [allPts[0].lng, allPts[0].lat], zoom: 13, duration: 0 })
      } else if (allPts.length > 1) {
        const bounds = new mapboxgl.LngLatBounds()
        for (const p of allPts) bounds.extend([p.lng, p.lat])
        map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 300 })
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, mapReady])

  // ── Driving polyline for the optimized selection ──────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource('route-path') as GeoJSONSource | undefined
    if (!source) return

    if (!orderedPathCoords) {
      source.setData({ type: 'FeatureCollection', features: [] })
      setPathFallback(false)
      return
    }
    const straight = straightLineFeature(orderedPathCoords)
    source.setData(straight)

    const ctrl = new AbortController()
    const timer = window.setTimeout(async () => {
      const feature = await fetchDirections(orderedPathCoords, MAPBOX_TOKEN, ctrl.signal)
      if (ctrl.signal.aborted) return
      const live = mapRef.current?.getSource('route-path') as GeoJSONSource | undefined
      if (!live) return
      if (feature) { live.setData(feature); setPathFallback(false) }
      else { live.setData(straight); setPathFallback(true) }
    }, 400)

    return () => { ctrl.abort(); window.clearTimeout(timer) }
  }, [orderedPathCoords, mapReady])

  // ── Highlight: ease to a pin and open its popup ───────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !highlightId) return
    const pin = pinsRef.current.find(p => p.id === highlightId)
    if (!pin) return
    map.easeTo({ center: [pin.lng, pin.lat], zoom: Math.max(map.getZoom(), 13), duration: 400 })
    const popup = popupRef.current
    if (popup) popup.setLngLat([pin.lng, pin.lat]).setHTML(popupHtml(pin)).addTo(map)
  }, [highlightId, mapReady])

  // ── Lasso: enable/disable map drag-pan so a freehand drag draws instead ────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (lassoActive) map.dragPan.disable()
    else map.dragPan.enable()
  }, [lassoActive, mapReady])

  function localPoint(e: React.PointerEvent<HTMLDivElement>): { x: number; y: number } {
    const rect = containerRef.current?.getBoundingClientRect()
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
  }

  function onLassoDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!lassoActive) return
    e.preventDefault()
    drawingRef.current = true
    overlayRef.current?.setPointerCapture(e.pointerId)
    setLassoPts([localPoint(e)])
  }
  function onLassoMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!lassoActive || !drawingRef.current) return
    setLassoPts(prev => [...prev, localPoint(e)])
  }
  function onLassoUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!lassoActive || !drawingRef.current) return
    drawingRef.current = false
    try { overlayRef.current?.releasePointerCapture(e.pointerId) } catch {}
    const poly = lassoPts
    setLassoPts([])
    const map = mapRef.current
    if (!map || poly.length < 3) return
    const hit: string[] = []
    for (const pin of pinsRef.current) {
      const p = map.project([pin.lng, pin.lat])
      if (pointInPolygon({ x: p.x, y: p.y }, poly)) hit.push(pin.id)
    }
    onLassoSelect(hit)
  }

  const lassoPath = lassoPts.length > 1
    ? `M ${lassoPts.map(p => `${p.x},${p.y}`).join(' L ')} Z`
    : ''

  return (
    <div style={{ position: 'relative', width: '100%', height: `${height}px`, background: '#0f172a' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Lasso draw overlay — only captures pointer events while active, so
          normal map pan/zoom and pin clicks work when lasso is off. */}
      <div
        ref={overlayRef}
        onPointerDown={onLassoDown}
        onPointerMove={onLassoMove}
        onPointerUp={onLassoUp}
        style={{
          position: 'absolute', inset: 0, zIndex: 20,
          pointerEvents: lassoActive ? 'auto' : 'none',
          cursor: lassoActive ? 'crosshair' : 'default',
          touchAction: lassoActive ? 'none' : 'auto',
        }}
      >
        {lassoActive && lassoPath && (
          <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
            <path d={lassoPath} fill="rgba(249,115,22,0.12)" stroke="#f97316" strokeWidth={2} strokeDasharray="6 4" />
          </svg>
        )}
      </div>

      {/* Toolbar (above the overlay so the toggle stays clickable in lasso mode) */}
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 30, display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => { setLassoActive(v => !v); setLassoPts([]) }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: lassoActive ? '#f97316' : 'rgba(15,23,42,0.85)',
            color: '#fff', border: '1px solid ' + (lassoActive ? '#fb923c' : '#334155'),
            borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          }}
          title="Draw a loop around stops to select them"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9a8 5 0 1 0 16 0 8 5 0 1 0-16 0" />
            <path d="M7 13.5 5.5 20l4-2" />
          </svg>
          {lassoActive ? 'Lasso on — drag to select' : 'Lasso'}
        </button>
      </div>

      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center text-red-300 text-sm bg-black/60 px-4 text-center">
          ⚠ {loadError}
        </div>
      )}
      {orderedPathCoords && pathFallback && !loadError && (
        <div className="absolute bottom-2 left-2 text-[11px] bg-black/60 text-yellow-300 px-2 py-1 rounded">
          Showing straight-line route — couldn&apos;t fetch road path
        </div>
      )}
    </div>
  )
}
