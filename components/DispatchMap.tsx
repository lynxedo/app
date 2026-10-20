'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Map as MapboxMap, Marker as MapboxMarker, Popup as MapboxPopup, GeoJSONSource, MapMouseEvent } from 'mapbox-gl'

// Dispatch map: each technician's real drive path in that tech's color, stops
// numbered to match the lane, the shop, and the drive home as a thinner line
// labeled "back to shop · N min" (Ben, Oct 19 2026 — replaced the mockup's
// unexplained dashed line). Unscheduled visits show as red squares so the
// office can see what's nearby. Hover a leg for from → to, minutes and miles.
//
// Oct 2026 (Advanced optimizer parity): add-on programs from Admin → Routing →
// Pin Colors draw a HALO ring around the pin (up to 3 arcs), and the LASSO
// lets the office draw around stops to tick / untick them for Optimize.

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

export interface DispatchMapStop {
  id: string
  lat: number
  lng: number
  label: string      // "1", "2"… or "" for anytime
  color: string      // tech color (ring) — fill is the stop's rule color
  fill: string
  locked: boolean
  title: string
  subtitle: string
  meta: string
  /** Add-on program colors (Pin Colors → aux programs) — drawn as a ring. */
  halo?: string[]
  /** Unticked in Route & optimize — drawn faded. */
  faded?: boolean
}

export interface DispatchMapLeg {
  coords: [number, number][]
  color: string
  isReturn: boolean
  label: string     // shown on the line for the return leg
  tooltip: string   // hover text
}

interface Props {
  depots: Array<{ lat: number; lng: number; label: string }>
  stops: DispatchMapStop[]
  legs: DispatchMapLeg[]
  unscheduled: Array<{ id: string; lat: number; lng: number; title: string; subtitle: string }>
  highlightId: string | null
  onStopClick: (id: string) => void
  /** When set, the map offers a Lasso: draw around stops to tick (select) or untick (deselect) them. */
  onLasso?: (ids: string[], mode: 'select' | 'deselect') => void
  /** Pixels or any CSS length, e.g. "max(520px, calc(100vh - 380px))" so it grows with the window. */
  height?: number | string
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))

const SVG_NS = 'http://www.w3.org/2000/svg'
const MAX_HALO = 3

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const pt = (deg: number) => { const a = (deg - 90) * Math.PI / 180; return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) } }
  const st = pt(endDeg), en = pt(startDeg)
  return `M ${st.x.toFixed(2)} ${st.y.toFixed(2)} A ${r} ${r} 0 ${endDeg - startDeg <= 180 ? 0 : 1} 0 ${en.x.toFixed(2)} ${en.y.toFixed(2)}`
}

// Fill = the stop's Dispatch color; border = the tech's color; optional halo
// arcs = add-on programs (same drawing as the Advanced optimizer's pins);
// pink glow = promised; faded = left out of Optimize.
function stopEl(s: DispatchMapStop, highlighted: boolean): HTMLElement {
  const halo = (s.halo ?? []).slice(0, MAX_HALO)
  const innerR = (s.label ? 26 : 16) / 2
  const ringW = 4, gap = 2
  const ringR = innerR + gap + ringW / 2
  const outerR = halo.length ? innerR + gap + ringW : innerR
  const size = Math.ceil((outerR + 5) * 2)
  const c = size / 2
  const wrap = document.createElement('div')
  wrap.style.cssText = `width:${size}px;height:${size}px;cursor:pointer;opacity:${s.faded ? 0.4 : 1};${highlighted ? 'transform:scale(1.3);' : ''}`
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('width', `${size}`); svg.setAttribute('height', `${size}`); svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
  svg.style.display = 'block'
  if (s.locked) svg.style.filter = 'drop-shadow(0 0 3px #ec4899) drop-shadow(0 0 3px #ec4899)'
  if (halo.length === 1) {
    const ring = document.createElementNS(SVG_NS, 'circle')
    ring.setAttribute('cx', `${c}`); ring.setAttribute('cy', `${c}`); ring.setAttribute('r', `${ringR}`)
    ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', halo[0]); ring.setAttribute('stroke-width', `${ringW}`)
    svg.appendChild(ring)
  } else if (halo.length > 1) {
    const seg = 360 / halo.length, gapDeg = 10
    halo.forEach((col, i) => {
      const path = document.createElementNS(SVG_NS, 'path')
      path.setAttribute('d', arcPath(c, c, ringR, i * seg + gapDeg / 2, (i + 1) * seg - gapDeg / 2))
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', col); path.setAttribute('stroke-width', `${ringW}`); path.setAttribute('stroke-linecap', 'round')
      svg.appendChild(path)
    })
  }
  const circle = document.createElementNS(SVG_NS, 'circle')
  circle.setAttribute('cx', `${c}`); circle.setAttribute('cy', `${c}`); circle.setAttribute('r', `${innerR - 1.5}`)
  circle.setAttribute('fill', s.fill); circle.setAttribute('stroke', s.color); circle.setAttribute('stroke-width', '3')
  svg.appendChild(circle)
  if (s.label) {
    const text = document.createElementNS(SVG_NS, 'text')
    text.setAttribute('x', `${c}`); text.setAttribute('y', `${c}`)
    text.setAttribute('text-anchor', 'middle'); text.setAttribute('dominant-baseline', 'central')
    text.setAttribute('fill', '#ffffff'); text.setAttribute('font-size', s.label.length >= 3 ? '9' : '12'); text.setAttribute('font-weight', '700')
    text.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif")
    text.textContent = s.label
    svg.appendChild(text)
  }
  wrap.appendChild(svg)
  return wrap
}

function pointInPolygon(pt: { x: number; y: number }, poly: Array<{ x: number; y: number }>): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}

export default function DispatchMap({ depots, stops, legs, unscheduled, highlightId, onStopClick, onLasso, height = 520 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const markersRef = useRef<MapboxMarker[]>([])
  const popupRef = useRef<MapboxPopup | null>(null)
  const hoverRef = useRef<MapboxPopup | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const onClickRef = useRef(onStopClick)
  useEffect(() => { onClickRef.current = onStopClick }, [onStopClick])

  // ── Lasso (draw around stops → tick / untick them for Optimize) ───────────
  const [lassoOn, setLassoOn] = useState(false)
  const [lassoMode, setLassoMode] = useState<'select' | 'deselect'>('select')
  const [lassoPts, setLassoPts] = useState<Array<{ x: number; y: number }>>([])
  const drawingRef = useRef(false)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const stopsRef = useRef(stops)
  useEffect(() => { stopsRef.current = stops }, [stops])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (lassoOn) map.dragPan.disable()
    else map.dragPan.enable()
  }, [lassoOn, ready])
  const localPoint = (e: React.PointerEvent) => {
    const r = containerRef.current?.getBoundingClientRect()
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
  }
  const lassoDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!lassoOn) return
    e.preventDefault()
    drawingRef.current = true
    overlayRef.current?.setPointerCapture(e.pointerId)
    setLassoPts([localPoint(e)])
  }
  const lassoMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!lassoOn || !drawingRef.current) return
    setLassoPts(prev => [...prev, localPoint(e)])
  }
  const lassoUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!lassoOn || !drawingRef.current) return
    drawingRef.current = false
    try { overlayRef.current?.releasePointerCapture(e.pointerId) } catch {}
    const poly = lassoPts
    setLassoPts([])
    const map = mapRef.current
    if (!map || poly.length < 3 || !onLasso) return
    const hit = stopsRef.current.filter(st => { const p = map.project([st.lng, st.lat]); return pointInPolygon({ x: p.x, y: p.y }, poly) }).map(st => st.id)
    if (hit.length) onLasso(hit, lassoMode)
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    if (!MAPBOX_TOKEN) { setLoadError('Mapbox token not configured'); return }
    let cancelled = false
    let cleanup: (() => void) | null = null
    ;(async () => {
      try {
        const mapboxgl = (await import('mapbox-gl')).default
        if (cancelled || !containerRef.current) return
        mapboxgl.accessToken = MAPBOX_TOKEN
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [-95.5, 30.2],
          zoom: 9.5,
        })
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
        map.on('load', () => {
          map.addSource('dispatch-legs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
          map.addLayer({
            id: 'dispatch-legs-main', type: 'line', source: 'dispatch-legs',
            filter: ['==', ['get', 'isReturn'], false],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': ['get', 'color'], 'line-width': 4.5, 'line-opacity': 0.9 },
          })
          map.addLayer({
            id: 'dispatch-legs-return', type: 'line', source: 'dispatch-legs',
            filter: ['==', ['get', 'isReturn'], true],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.75 },
          })
          map.addLayer({
            id: 'dispatch-legs-return-label', type: 'symbol', source: 'dispatch-legs',
            filter: ['==', ['get', 'isReturn'], true],
            layout: {
              'symbol-placement': 'line-center',
              'text-field': ['get', 'label'],
              'text-size': 11,
              'text-offset': [0, -0.9],
              'text-allow-overlap': false,
            },
            paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
          })
          const hover = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 8 })
          hoverRef.current = hover
          for (const layer of ['dispatch-legs-main', 'dispatch-legs-return']) {
            map.on('mousemove', layer, (e: MapMouseEvent & { features?: Array<{ properties?: Record<string, unknown> | null }> }) => {
              map.getCanvas().style.cursor = 'pointer'
              const tip = String(e.features?.[0]?.properties?.tooltip ?? '')
              if (tip) hover.setLngLat(e.lngLat).setHTML(`<div style="font:12px -apple-system,Segoe UI,sans-serif;color:#0f172a">${esc(tip)}</div>`).addTo(map)
            })
            map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; hover.remove() })
          }
          setReady(true)
        })
        popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, offset: 16 })
        mapRef.current = map
        const ro = new ResizeObserver(() => map.resize())
        ro.observe(containerRef.current)
        cleanup = () => ro.disconnect()
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Map failed to load')
      }
    })()
    return () => {
      cancelled = true
      cleanup?.()
      popupRef.current?.remove()
      hoverRef.current?.remove()
      mapRef.current?.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  // Legs
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const src = map.getSource('dispatch-legs') as GeoJSONSource | undefined
    src?.setData({
      type: 'FeatureCollection',
      features: legs.filter(l => l.coords.length >= 2).map(l => ({
        type: 'Feature',
        properties: { color: l.color, isReturn: l.isReturn, label: l.label, tooltip: l.tooltip },
        geometry: { type: 'LineString', coordinates: l.coords },
      })),
    })
  }, [legs, ready])

  // Markers
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    let cancelled = false
    ;(async () => {
      const mapboxgl = (await import('mapbox-gl')).default
      if (cancelled || !mapRef.current) return
      for (const m of markersRef.current) m.remove()
      markersRef.current = []
      for (const d of depots) {
        const el = document.createElement('div')
        el.style.cssText = 'width:24px;height:24px;border-radius:6px;background:#16a34a;color:#fff;display:flex;align-items:center;justify-content:center;font:700 11px -apple-system,Segoe UI,sans-serif;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)'
        el.textContent = '⌂'
        el.title = d.label
        markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([d.lng, d.lat]).addTo(map))
      }
      for (const u of unscheduled) {
        const el = document.createElement('div')
        el.style.cssText = 'width:12px;height:12px;background:#dc2626;border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,.4);cursor:pointer'
        el.addEventListener('click', ev => {
          ev.stopPropagation()
          onClickRef.current(u.id)
          popupRef.current?.setLngLat([u.lng, u.lat]).setHTML(
            `<div style="font:12px -apple-system,Segoe UI,sans-serif;color:#0f172a"><b>${esc(u.title)}</b><br>${esc(u.subtitle)}<br><span style="color:#dc2626">Unscheduled</span></div>`,
          ).addTo(map)
        })
        markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([u.lng, u.lat]).addTo(map))
      }
      for (const s of stops) {
        const el = stopEl(s, s.id === highlightId)
        el.addEventListener('click', ev => {
          ev.stopPropagation()
          onClickRef.current(s.id)
          popupRef.current?.setLngLat([s.lng, s.lat]).setHTML(
            `<div style="font:12px -apple-system,Segoe UI,sans-serif;color:#0f172a;min-width:150px"><b>${esc(s.title)}</b><br>${esc(s.subtitle)}<br><span style="color:#ea580c">${esc(s.meta)}</span></div>`,
          ).addTo(map)
        })
        markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map))
      }
    })()
    return () => { cancelled = true }
  }, [depots, stops, unscheduled, highlightId, ready])

  // Fit when the set of places changes (not on every hover/highlight).
  const fitKey = useMemo(
    () => [...depots.map(d => `${d.lat},${d.lng}`), ...stops.map(s => s.id), ...unscheduled.map(u => u.id)].join('|'),
    [depots, stops, unscheduled],
  )
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const pts = [...depots, ...stops, ...(stops.length ? [] : unscheduled)]
    if (pts.length === 0) return
    ;(async () => {
      const mapboxgl = (await import('mapbox-gl')).default
      const b = new mapboxgl.LngLatBounds()
      for (const p of pts) b.extend([p.lng, p.lat])
      map.fitBounds(b, { padding: 50, maxZoom: 13, duration: 400 })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready])

  if (loadError) {
    return <div className="rounded-xl border border-gray-800 bg-gray-900 text-gray-400 text-sm flex items-center justify-center" style={{ height }}>Map unavailable: {loadError}</div>
  }
  const lassoPath = lassoPts.length > 1 ? `M ${lassoPts.map(p => `${p.x},${p.y}`).join(' L ')} Z` : ''
  return (
    <div className="relative rounded-xl overflow-hidden border border-gray-800" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      {onLasso && (
        <>
          <div ref={overlayRef} onPointerDown={lassoDown} onPointerMove={lassoMove} onPointerUp={lassoUp}
            className="absolute inset-0 z-10"
            style={{ pointerEvents: lassoOn ? 'auto' : 'none', cursor: lassoOn ? 'crosshair' : 'default', touchAction: lassoOn ? 'none' : 'auto' }}>
            {lassoOn && lassoPath && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                <path d={lassoPath} fill="rgba(249,115,22,0.12)" stroke="#f97316" strokeWidth={2} strokeDasharray="6 4" />
              </svg>
            )}
          </div>
          <div className="absolute top-2 left-2 z-20 flex gap-1 text-xs">
            <button type="button" onClick={() => { setLassoOn(v => !v); setLassoPts([]) }}
              className={`px-2 py-1 rounded-md border ${lassoOn ? 'bg-orange-500 border-orange-400 text-[#fff]' : 'bg-slate-900/85 border-slate-700 text-[#fff]'}`}
              title="Draw around stops on the map to tick or untick them for Optimize">
              {lassoOn ? (lassoMode === 'select' ? '◌ Lasso: draw to tick' : '◌ Lasso: draw to untick') : '◌ Lasso'}
            </button>
            {lassoOn && (
              <>
                <button type="button" onClick={() => setLassoMode('select')}
                  className={`px-2 py-1 rounded-md border text-[#fff] ${lassoMode === 'select' ? 'bg-green-600 border-green-500' : 'bg-slate-900/85 border-slate-700'}`}>Tick</button>
                <button type="button" onClick={() => setLassoMode('deselect')}
                  className={`px-2 py-1 rounded-md border text-[#fff] ${lassoMode === 'deselect' ? 'bg-red-600 border-red-500' : 'bg-slate-900/85 border-slate-700'}`}>Untick</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
