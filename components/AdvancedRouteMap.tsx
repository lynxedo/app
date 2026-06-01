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
  color: string        // full CSS color for the center fill (e.g. "#e47200") — the base program color
  auxColors?: string[] // halo arc colors (aux programs); only the first 3 are drawn
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
  /** Called with the visit ids inside the drawn loop. The parent applies them
   *  additively (select) or subtractively (deselect) based on `lassoMode`. */
  onLassoSelect: (ids: string[]) => void
  onPinClick: (id: string) => void
  /** When set, the map eases to that pin and opens its popup. */
  highlightId: string | null
  /** Lasso behavior: add to or remove from the current selection. */
  lassoMode: 'select' | 'deselect'
  onLassoModeChange: (mode: 'select' | 'deselect') => void
  /** Clears the entire current selection (toolbar button). */
  onClearSelection: () => void
  /** Current selection size — drives the Clear button visibility/label. */
  selectedCount: number
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

const SVG_NS = 'http://www.w3.org/2000/svg'
const MAX_HALO = 3   // mirror of lib/pin-colors MAX_HALO_ARCS — only draw the first 3 aux arcs

function polarToXY(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const a = (angleDeg - 90) * Math.PI / 180
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

// Arc path from startDeg→endDeg (clockwise), used for halo segments (< 360°).
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polarToXY(cx, cy, r, endDeg)
  const end = polarToXY(cx, cy, r, startDeg)
  const largeArc = endDeg - startDeg <= 180 ? '0' : '1'
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
}

// Custom marker: a base-color circle (program color) with an optional aux halo
// ring around it and an optional center label. Selection shows as an orange glow
// so the base/program color is never overwritten.
function buildPinEl(pin: AdvPin): HTMLDivElement {
  const aux = (pin.auxColors ?? []).slice(0, MAX_HALO)
  const hasHalo = aux.length > 0

  const innerR = (pin.label ? 26 : 18) / 2   // bigger when a number is shown; dots bumped up so halos read
  const gap = 2
  const ringW = 4
  const ringR = innerR + gap + ringW / 2          // center radius of the halo stroke
  const outerR = hasHalo ? innerR + gap + ringW : innerR
  const pad = 7                                    // room for the selection glow + ring stroke
  const size = Math.ceil((outerR + pad) * 2)
  const c = size / 2

  const wrap = document.createElement('div')
  wrap.style.width = `${size}px`
  wrap.style.height = `${size}px`
  wrap.style.cursor = 'pointer'
  wrap.style.opacity = pin.dimmed ? '0.35' : '1'
  wrap.style.transition = 'opacity 0.15s'
  if (pin.title) wrap.title = pin.title

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('width', `${size}`)
  svg.setAttribute('height', `${size}`)
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
  svg.style.display = 'block'
  if (pin.selected) {
    svg.style.filter = 'drop-shadow(0 0 2px #f97316) drop-shadow(0 0 5px #f97316)'
  }

  // Halo ring (aux programs)
  if (hasHalo) {
    if (aux.length === 1) {
      const ring = document.createElementNS(SVG_NS, 'circle')
      ring.setAttribute('cx', `${c}`); ring.setAttribute('cy', `${c}`); ring.setAttribute('r', `${ringR}`)
      ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', aux[0]); ring.setAttribute('stroke-width', `${ringW}`)
      svg.appendChild(ring)
    } else {
      const n = aux.length
      const gapDeg = 10
      const seg = 360 / n
      for (let i = 0; i < n; i++) {
        const start = i * seg + gapDeg / 2
        const end = (i + 1) * seg - gapDeg / 2
        const path = document.createElementNS(SVG_NS, 'path')
        path.setAttribute('d', arcPath(c, c, ringR, start, end))
        path.setAttribute('fill', 'none')
        path.setAttribute('stroke', aux[i])
        path.setAttribute('stroke-width', `${ringW}`)
        path.setAttribute('stroke-linecap', 'round')
        svg.appendChild(path)
      }
    }
  }

  // Base circle (program color)
  const circle = document.createElementNS(SVG_NS, 'circle')
  circle.setAttribute('cx', `${c}`); circle.setAttribute('cy', `${c}`); circle.setAttribute('r', `${innerR}`)
  circle.setAttribute('fill', pin.color)
  circle.setAttribute('stroke', '#ffffff')
  circle.setAttribute('stroke-width', pin.selected ? '2.5' : '2')
  svg.appendChild(circle)

  // Center label: route-order number (optimized) or days-since-last-visit (unoptimized).
  // 3-char labels (e.g. "365") use a smaller font so they don't overflow the circle.
  if (pin.label) {
    const text = document.createElementNS(SVG_NS, 'text')
    text.setAttribute('x', `${c}`); text.setAttribute('y', `${c}`)
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('dominant-baseline', 'central')
    text.setAttribute('fill', '#ffffff')
    text.setAttribute('font-size', pin.label.length >= 3 ? '9' : '12')
    text.setAttribute('font-weight', '700')
    text.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif")
    text.textContent = pin.label
    svg.appendChild(text)
  }

  wrap.appendChild(svg)
  return wrap
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
  lassoMode,
  onLassoModeChange,
  onClearSelection,
  selectedCount,
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
          label: 'D', color: '#16a34a', selected: false, dimmed: false, title: 'Depot',
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

      {/* Toolbar (above the overlay so the controls stay clickable in lasso mode) */}
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 30, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
          title="Draw a loop around stops to select (or deselect) them"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9a8 5 0 1 0 16 0 8 5 0 1 0-16 0" />
            <path d="M7 13.5 5.5 20l4-2" />
          </svg>
          {lassoActive
            ? (lassoMode === 'select' ? 'Lasso: drag to add' : 'Lasso: drag to remove')
            : 'Lasso'}
        </button>

        {/* Select / Deselect mode switch — only meaningful while lassoing */}
        {lassoActive && (
          <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #334155', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
            <button
              type="button"
              onClick={() => onLassoModeChange('select')}
              style={{
                background: lassoMode === 'select' ? '#16a34a' : 'rgba(15,23,42,0.85)',
                color: '#fff', border: 'none', padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Select
            </button>
            <button
              type="button"
              onClick={() => onLassoModeChange('deselect')}
              style={{
                background: lassoMode === 'deselect' ? '#dc2626' : 'rgba(15,23,42,0.85)',
                color: '#fff', border: 'none', borderLeft: '1px solid #334155', padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Deselect
            </button>
          </div>
        )}

        {/* Clear the whole selection */}
        {selectedCount > 0 && (
          <button
            type="button"
            onClick={onClearSelection}
            style={{
              background: 'rgba(15,23,42,0.85)', color: '#fca5a5', border: '1px solid #334155',
              borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
            }}
            title="Clear the entire selection"
          >
            Clear ({selectedCount})
          </button>
        )}
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
