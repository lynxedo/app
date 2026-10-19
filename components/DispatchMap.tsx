'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Map as MapboxMap, Marker as MapboxMarker, Popup as MapboxPopup, GeoJSONSource, MapMouseEvent } from 'mapbox-gl'

// Dispatch map: each technician's real drive path in that tech's color, stops
// numbered to match the lane, the shop, and the drive home as a thinner line
// labeled "back to shop · N min" (Ben, Oct 19 2026 — replaced the mockup's
// unexplained dashed line). Unscheduled visits show as red squares so the
// office can see what's nearby. Hover a leg for from → to, minutes and miles.

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
  height?: number
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))

function stopEl(s: DispatchMapStop, highlighted: boolean): HTMLElement {
  const el = document.createElement('div')
  const size = s.label ? 26 : 16
  el.style.cssText = [
    `width:${size}px`, `height:${size}px`, 'border-radius:50%', 'cursor:pointer',
    `background:${s.fill}`, `border:3px solid ${s.color}`,
    s.locked ? 'box-shadow:0 0 0 3px #ec4899' : 'box-shadow:0 1px 3px rgba(0,0,0,.4)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'color:#fff', 'font:700 12px -apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif',
    highlighted ? 'transform:scale(1.35)' : '',
  ].join(';')
  el.textContent = s.label
  return el
}

export default function DispatchMap({ depots, stops, legs, unscheduled, highlightId, onStopClick, height = 520 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const markersRef = useRef<MapboxMarker[]>([])
  const popupRef = useRef<MapboxPopup | null>(null)
  const hoverRef = useRef<MapboxPopup | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const onClickRef = useRef(onStopClick)
  useEffect(() => { onClickRef.current = onStopClick }, [onStopClick])

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
  return <div ref={containerRef} className="rounded-xl overflow-hidden border border-gray-800" style={{ height }} />
}
