'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Map as MapboxMap, Marker as MapboxMarker, GeoJSONSource } from 'mapbox-gl'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

export interface RoutePreviewPin {
  id: string
  lat: number
  lng: number
  label: string   // text shown inside the pin (e.g. "1", "12", "a")
  color: string   // hex without # (e.g. "c0392b") — matches Static API conventions
  title?: string  // tooltip on hover
}

interface RoutePreviewMapProps {
  depotCoord: { lat: number; lng: number } | null
  pins: RoutePreviewPin[]
  /**
   * When true, fetches the actual driving polyline via Mapbox Directions API
   * for the path depot → pins[0] → pins[1] → … → depot. Pins must already be
   * in the desired visit order. When false, no polyline is drawn.
   */
  drawDrivePath: boolean
  /** Pixel height of the map. Defaults to 520. */
  height?: number
}

// In-process cache: ordered coord-string → GeoJSON LineString feature.
// Keeps undo/redo and small drag tweaks free after the first fetch.
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
    const data = await res.json() as {
      code: string
      routes?: Array<{ geometry: GeoJSON.LineString }>
    }
    if (data.code !== 'Ok' || !data.routes?.[0]?.geometry) return null
    const feature: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      properties: {},
      geometry: data.routes[0].geometry,
    }
    directionsCache.set(key, feature)
    return feature
  } catch {
    return null
  }
}

function straightLineFeature(
  pts: Array<{ lat: number; lng: number }>,
): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: pts.map(p => [p.lng, p.lat]),
    },
  }
}

function buildPinEl(pin: RoutePreviewPin): HTMLDivElement {
  const el = document.createElement('div')
  el.style.width = '28px'
  el.style.height = '28px'
  el.style.borderRadius = '50%'
  el.style.background = `#${pin.color}`
  el.style.border = '2px solid #fff'
  el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.5)'
  el.style.color = '#fff'
  el.style.fontSize = '12px'
  el.style.fontWeight = 'bold'
  el.style.display = 'flex'
  el.style.alignItems = 'center'
  el.style.justifyContent = 'center'
  el.style.fontFamily =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
  el.style.cursor = 'pointer'
  el.textContent = pin.label
  if (pin.title) el.title = pin.title
  return el
}

export default function RoutePreviewMap({
  depotCoord,
  pins,
  drawDrivePath,
  height = 520,
}: RoutePreviewMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const markersRef = useRef<MapboxMarker[]>([])
  const [mapReady, setMapReady] = useState(false)
  const [pathFallback, setPathFallback] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Memoize the ordered coords used for both pins and the path,
  // so the path-fetch effect doesn't fire on unrelated re-renders.
  const orderedPathCoords = useMemo(() => {
    if (!depotCoord || pins.length === 0) return null
    return [depotCoord, ...pins.map(p => ({ lat: p.lat, lng: p.lng })), depotCoord]
  }, [depotCoord, pins])

  // ── Initial map setup ────────────────────────────────────────────────────
  // mapbox-gl is browser-only. We lazy-load it inside the effect so that the
  // module never reaches the SSR chunk (an earlier static top-level import
  // crashed Turbopack with "module factory is not available" on /dashboard
  // and /hub/routing).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    if (!MAPBOX_TOKEN) {
      setLoadError('Mapbox token not configured')
      return
    }

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
          map.addSource('route-path', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          })
          map.addLayer({
            id: 'route-path-line',
            type: 'line',
            source: 'route-path',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#1f77b4',
              'line-width': 4,
              'line-opacity': 0.85,
            },
          })
          setMapReady(true)
        })
        mapRef.current = map

        // Mapbox needs explicit resize calls when the container's pixel
        // dimensions settle after the surrounding flex layout. Hammer a few
        // frames, then keep observing for ongoing changes.
        const container = containerRef.current
        const ro = new ResizeObserver(() => map.resize())
        ro.observe(container)
        const timers: number[] = []
        ;[0, 50, 200, 500, 1000].forEach(ms => {
          timers.push(window.setTimeout(() => map.resize(), ms))
        })
        cleanupResize = () => {
          timers.forEach(t => window.clearTimeout(t))
          ro.disconnect()
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Map failed to load')
        }
      }
    })()

    return () => {
      cancelled = true
      cleanupResize?.()
      mapRef.current?.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // ── Render pins (depot + visits) ─────────────────────────────────────────
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
          id: '__depot__',
          lat: depotCoord.lat,
          lng: depotCoord.lng,
          label: 'D',
          color: '16a34a',
          title: 'Depot',
        })
        const m = new mapboxgl.Marker({ element: el })
          .setLngLat([depotCoord.lng, depotCoord.lat])
          .addTo(map)
        markersRef.current.push(m)
      }

      for (const pin of pins) {
        const el = buildPinEl(pin)
        const m = new mapboxgl.Marker({ element: el })
          .setLngLat([pin.lng, pin.lat])
          .addTo(map)
        markersRef.current.push(m)
      }

      const allPts: Array<{ lat: number; lng: number }> = [
        ...(depotCoord ? [depotCoord] : []),
        ...pins,
      ]
      if (allPts.length === 1) {
        map.easeTo({ center: [allPts[0].lng, allPts[0].lat], zoom: 13, duration: 0 })
      } else if (allPts.length > 1) {
        const bounds = new mapboxgl.LngLatBounds()
        for (const p of allPts) bounds.extend([p.lng, p.lat])
        map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 300 })
      }
    })()

    return () => { cancelled = true }
  }, [depotCoord, pins, mapReady])

  // ── Fetch + render the driving polyline (debounced) ──────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource('route-path') as GeoJSONSource | undefined
    if (!source) return

    if (!drawDrivePath || !orderedPathCoords) {
      source.setData({ type: 'FeatureCollection', features: [] })
      setPathFallback(false)
      return
    }

    // Show straight lines immediately so the user sees *something* while the
    // Directions API call is in flight or debouncing.
    const straight = straightLineFeature(orderedPathCoords)
    source.setData(straight)

    const ctrl = new AbortController()
    const timer = window.setTimeout(async () => {
      const feature = await fetchDirections(orderedPathCoords, MAPBOX_TOKEN, ctrl.signal)
      if (ctrl.signal.aborted) return
      const live = mapRef.current?.getSource('route-path') as GeoJSONSource | undefined
      if (!live) return
      if (feature) {
        live.setData(feature)
        setPathFallback(false)
      } else {
        live.setData(straight)
        setPathFallback(true)
      }
    }, 400)

    return () => {
      ctrl.abort()
      window.clearTimeout(timer)
    }
  }, [orderedPathCoords, drawDrivePath, mapReady])

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: `${height}px`,
        background: '#0f172a',
      }}
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center text-red-300 text-sm bg-black/60 px-4 text-center">
          ⚠ {loadError}
        </div>
      )}
      {drawDrivePath && pathFallback && !loadError && (
        <div className="absolute bottom-2 left-2 text-[11px] bg-black/60 text-yellow-300 px-2 py-1 rounded">
          Showing straight-line route — couldn&apos;t fetch road path
        </div>
      )}
    </div>
  )
}
