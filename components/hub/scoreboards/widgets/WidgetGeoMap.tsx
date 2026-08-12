'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Map as MapboxMap } from 'mapbox-gl'
import type { GeoPayload } from '@/lib/scoreboards/widgets/payloads'
import { formatCurrency } from '@/lib/format'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

/* The one canvas visual in the widget library.
 *
 * Every other chart here is hand-drawn SVG/CSS precisely to avoid a canvas
 * lifecycle inside a card a user can drag and resize. A map genuinely needs one, so
 * this file is the exception and it carries the cost of being the exception:
 *   - it lives on its own and is loaded with next/dynamic({ ssr: false }), so
 *     mapbox-gl stays out of the shared Reports bundle for the seven reports that
 *     have no map;
 *   - a ResizeObserver calls map.resize(), because a card resized by drag does not
 *     fire a window resize and the canvas would otherwise render at its old width;
 *   - the map is torn down on unmount, which matters more here than usual since
 *     Workspace Tabs keeps screens mounted-but-hidden.
 *
 * Circles at ZIP centre points, not shaded boundaries: ZIP polygons are a paid
 * Mapbox entitlement and a large payload, and at a glance the two read the same.
 */

/** Five steps, low to high — a sequential ramp, so bigger reads as more. */
const RAMP = ['#dbeafe', '#bfdbfe', '#7dd3fc', '#3b82f6', '#1e3a8a']

function stepFor(value: number, max: number): number {
  if (max <= 0) return 0
  const share = value / max
  // Rank-free thresholds so the legend can state real ranges rather than quintiles
  // that shift every time the window changes.
  if (share >= 0.8) return 4
  if (share >= 0.55) return 3
  if (share >= 0.3) return 2
  if (share >= 0.1) return 1
  return 0
}

export default function WidgetGeoMap({ p }: { p: GeoPayload }) {
  const holder = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const fmt = useMemo(
    () => (v: number) => (p.format === 'currency' ? formatCurrency(v) : v.toLocaleString()),
    [p.format],
  )
  const max = useMemo(() => p.points.reduce((m, x) => Math.max(m, x.value), 0), [p.points])

  useEffect(() => {
    if (!holder.current || !p.points.length) return
    if (!MAPBOX_TOKEN) { setFailed('No map token configured'); return }

    let map: MapboxMap | null = null
    let observer: ResizeObserver | null = null
    let cancelled = false

    // Dynamic import so the library is fetched only when a map actually renders.
    import('mapbox-gl').then(({ default: mapboxgl }) => {
      if (cancelled || !holder.current) return
      mapboxgl.accessToken = MAPBOX_TOKEN

      const lats = p.points.map(x => x.lat)
      const lngs = p.points.map(x => x.lng)

      map = new mapboxgl.Map({
        container: holder.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        fitBoundsOptions: { padding: 44 },
        attributionControl: false,
      })
      mapRef.current = map
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

      // Biggest first, so a large faint circle can never bury a small dark one.
      const ordered = [...p.points].sort((a, b) => b.value - a.value)
      for (const pt of ordered) {
        const step = stepFor(pt.value, max)
        const el = document.createElement('div')
        const size = 16 + step * 8
        el.style.width = `${size}px`
        el.style.height = `${size}px`
        el.style.borderRadius = '50%'
        el.style.background = RAMP[step]
        el.style.border = '2px solid rgba(255,255,255,0.85)'
        el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.35)'
        el.style.cursor = 'default'
        el.title = `${pt.id} — ${fmt(pt.value)}${pt.detail ? ` · ${pt.detail}` : ''}`
        new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([pt.lng, pt.lat])
          .setPopup(new mapboxgl.Popup({ offset: 14, closeButton: false }).setHTML(
            `<div style="font:600 12px system-ui;color:#111">${pt.id}</div>` +
            `<div style="font:12px system-ui;color:#111">${fmt(pt.value)}</div>` +
            (pt.detail ? `<div style="font:11px system-ui;color:#555">${pt.detail}</div>` : ''),
          ))
          .addTo(map)
      }

      // A card resized by dragging its edge fires no window resize, so the canvas
      // would keep its old width until something else forced a repaint.
      observer = new ResizeObserver(() => map?.resize())
      observer.observe(holder.current)
    }).catch(e => {
      if (!cancelled) setFailed(e instanceof Error ? e.message : 'Map failed to load')
    })

    return () => {
      cancelled = true
      observer?.disconnect()
      map?.remove()
      mapRef.current = null
    }
  }, [p.points, max, fmt])

  if (!p.points.length) {
    return <div className="py-6 text-center text-[12px] text-gray-500">{p.empty ?? 'Nothing to map yet'}</div>
  }
  if (failed) {
    return <div className="py-6 text-center text-[12px] text-gray-500">Map unavailable — {failed}</div>
  }

  return (
    <>
      <div ref={holder} className="mt-1 h-[320px] w-full overflow-hidden rounded-xl border border-white/10" />
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-gray-500">
        <span>Low</span>
        {RAMP.map((c, i) => (
          <span key={i} className="inline-block h-2.5 w-4 rounded-sm" style={{ background: c }} />
        ))}
        <span>High · up to {fmt(max)}</span>
      </div>
    </>
  )
}
