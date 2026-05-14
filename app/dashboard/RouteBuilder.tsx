'use client'

import { useEffect, useState } from 'react'

interface JobberUser {
  id: string
  name: string
}

interface LineItem {
  name: string
  qty: number
  unitPrice: number
  totalPrice: number
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
  matrixIndex: number  // index in allPoints from optimize API (0=depot, 1..n=stops)
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

interface SendResult {
  visitId: string
  success: boolean
  error?: string
}

function todayLocal() {
  const d = new Date()
  return d.toISOString().split('T')[0]
}

// ── Client-side helpers (mirror of server-side equivalents) ──
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function fmtTimeClient(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = Math.round(totalMinutes % 60)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
}

function toISOLocalClient(date: string, totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = Math.round(totalMinutes % 60)
  return `${date}T${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`
}

// Precision-5 encoded polyline for Mapbox Static Images API path overlay
function encodePolyline5(pts: Array<{ lat: number; lng: number }>): string {
  let result = '', prevLat5 = 0, prevLng5 = 0
  function encCoord(n: number): string {
    let v = n < 0 ? ~(n << 1) : (n << 1)
    let s = ''
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>>= 5 }
    return s + String.fromCharCode(v + 63)
  }
  for (const p of pts) {
    const lat5 = Math.round(p.lat * 1e5)
    const lng5 = Math.round(p.lng * 1e5)
    result += encCoord(lat5 - prevLat5) + encCoord(lng5 - prevLng5)
    prevLat5 = lat5; prevLng5 = lng5
  }
  return result
}

export default function RouteBuilder() {
  const [users, setUsers] = useState<JobberUser[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState<string | null>(null)

  const [date, setDate] = useState(todayLocal())
  const [selectedUserId, setSelectedUserId] = useState('')
  const [startTime, setStartTime] = useState('08:00')  // HH:MM

  const [visits, setVisits] = useState<Visit[] | null>(null)
  const [visitsLoading, setVisitsLoading] = useState(false)
  const [visitsError, setVisitsError] = useState<string | null>(null)

  const [optimizedVisits, setOptimizedVisits] = useState<OptimizedVisit[] | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)
  const [geocodeFailed, setGeocodeFailed] = useState<number[]>([])
  const [usingMatrix, setUsingMatrix] = useState<boolean | null>(null)

  // Depot coords (returned from optimize API, used for map)
  const [depotCoord, setDepotCoord] = useState<{ lat: number; lng: number } | null>(null)

  // Matrix / speed — stored for client-side ETA recalculation after drag-reorder
  const [durationMatrix, setDurationMatrix] = useState<number[][] | null>(null)
  const [avgSpeedKmh, setAvgSpeedKmh] = useState<number>(40)

  // Lock first/last stop before optimizing
  const [lockedFirstId, setLockedFirstId] = useState<string | null>(null)
  const [lockedLastId, setLockedLastId] = useState<string | null>(null)

  // Drag-to-reorder state
  const [isManualOrder, setIsManualOrder] = useState(false)
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // Duration method (loaded from settings, overridable per session)
  const [durationMethod, setDurationMethod] = useState<string>('default')
  const [fallbackStops, setFallbackStops] = useState<string[]>([])

  // Map preview shown on the optimize screen after optimization completes
  const [previewMapUrl, setPreviewMapUrl] = useState<string | null>(null)

  // Send to Jobber state
  const [reassignUserId, setReassignUserId] = useState<string>('__keep__')
  const [sending, setSending] = useState(false)
  const [sendResults, setSendResults] = useState<SendResult[] | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  // Load settings on mount (get saved duration_method default)
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        if (data.settings?.duration_method) {
          setDurationMethod(data.settings.duration_method)
        }
      })
      .catch(() => {}) // non-critical
  }, [])

  // Load users on mount
  useEffect(() => {
    fetch('/api/users')
      .then(r => r.json())
      .then(data => {
        if (data.error) { setUsersError(data.error); return }
        setUsers(data.users)
        if (data.users.length > 0) setSelectedUserId(data.users[0].id)
      })
      .catch(e => setUsersError(e.message))
      .finally(() => setUsersLoading(false))
  }, [])

  async function loadVisits() {
    if (!selectedUserId) return
    setVisitsLoading(true)
    setVisitsError(null)
    setVisits(null)
    setOptimizedVisits(null)
    setOptimizeError(null)
    setGeocodeFailed([])
    setSendResults(null)
    setSendError(null)
    setDurationMatrix(null)
    setIsManualOrder(false)
    setLockedFirstId(null)
    setLockedLastId(null)
    setFallbackStops([])
    setPreviewMapUrl(null)
    try {
      const res = await fetch(`/api/visits?date=${date}&userId=${encodeURIComponent(selectedUserId)}`)
      const data = await res.json()
      if (data.error) { setVisitsError(data.error); return }
      setVisits(data.visits)
    } catch (e) {
      setVisitsError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setVisitsLoading(false)
    }
  }

  async function optimizeRoute() {
    if (!visits || visits.length === 0) return
    setOptimizing(true)
    setOptimizeError(null)
    setGeocodeFailed([])
    setSendResults(null)
    setSendError(null)
    try {
      const addresses = visits.map(v => v.addressString)
      const jobTitles = visits.map(v => v.jobTitle)
      const [hh, mm] = startTime.split(':').map(Number)
      const startHour = hh + mm / 60

      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addresses,
          jobTitles,
          startHour,
          date,
          lockedFirstIdx: lockedFirstId ? visits.findIndex(v => v.id === lockedFirstId) : undefined,
          lockedLastIdx: lockedLastId ? visits.findIndex(v => v.id === lockedLastId) : undefined,
          visitLineItems: visits.map(v => v.lineItemNames ?? []),
          visitTypes: visits.map(v => v.type ?? 'visit'),
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
        durationMatrix?: number[][] | null
        matrixIndices?: number[]
        avgSpeedKmh?: number
        error?: string
      } = await res.json()
      if (data.error) { setOptimizeError(data.error); return }

      setGeocodeFailed(data.geocodeFailed ?? [])
      setUsingMatrix(data.usingMatrix ?? false)
      if (data.depotCoord) setDepotCoord(data.depotCoord)
      setDurationMatrix(data.durationMatrix ?? null)
      setAvgSpeedKmh(data.avgSpeedKmh ?? 40)
      setIsManualOrder(false)

      // Capture stops that fell back to default duration
      const fbStops = (data.legs ?? [])
        .map((leg: Leg, i: number) => leg.usedFallback ? visits[data.order[i]]?.clientName : null)
        .filter((n: string | null): n is string => !!n)
      setFallbackStops(fbStops)

      const reordered: OptimizedVisit[] = data.order.map((originalIdx, newPos) => ({
        ...visits[originalIdx],
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
      setOptimizedVisits(reordered)

      // Build static map preview URL (same map as the route sheet)
      const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
      if (mapboxToken && data.depotCoord && reordered.length > 0) {
        const dep = data.depotCoord
        const waypoints = [dep, ...reordered.map(v => ({ lat: v.lat, lng: v.lng }))]
        const polyline = encodePolyline5(waypoints)
        const pathOverlay = `path-3+1f77b4-0.85(${encodeURIComponent(polyline)})`
        const depotMarker = `pin-s-d+16a34a(${dep.lng.toFixed(6)},${dep.lat.toFixed(6)})`
        const stopMarkers = reordered.map((v, i) => {
          const label = i < 9 ? String(i + 1) : String.fromCharCode(97 + (i - 9))
          return `pin-s-${label}+c0392b(${v.lng.toFixed(6)},${v.lat.toFixed(6)})`
        })
        const overlays = [pathOverlay, depotMarker, ...stopMarkers].join(',')
        setPreviewMapUrl(
          `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays}/auto/800x380@2x?padding=50&access_token=${mapboxToken}`
        )
      }
    } catch (e) {
      setOptimizeError(e instanceof Error ? e.message : 'Optimization failed')
    } finally {
      setOptimizing(false)
    }
  }

  async function sendToJobber() {
    if (!optimizedVisits) return
    setSending(true)
    setSendError(null)
    setSendResults(null)

    const visitsPayload = optimizedVisits
      .filter(v => v.startAtISO && v.endAtISO)
      .map(v => ({ visitId: v.id, startAt: v.startAtISO!, endAt: v.endAtISO! }))

    if (visitsPayload.length === 0) {
      setSendError('No visits have timestamps — re-optimize to generate times.')
      setSending(false)
      return
    }

    try {
      const res = await fetch('/api/send-to-jobber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visits: visitsPayload,
          assignedUserId: reassignUserId === '__keep__' ? null : reassignUserId,
        }),
      })
      const data: { results: SendResult[]; allOk: boolean; error?: string } = await res.json()
      if (data.error) { setSendError(data.error); return }
      setSendResults(data.results)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Failed to send to Jobber')
    } finally {
      setSending(false)
    }
  }

  function recalculateETAs() {
    if (!optimizedVisits || optimizedVisits.length === 0) return
    const [hh, mm] = startTime.split(':').map(Number)
    let elapsedMin = (hh + mm / 60) * 60
    let prevMatrixIdx = 0  // depot is always index 0

    const recalculated = optimizedVisits.map((v, i) => {
      let driveMin: number
      let distKm: number

      if (durationMatrix) {
        // Real road time from cached matrix (seconds → minutes)
        driveMin = Math.round(durationMatrix[prevMatrixIdx][v.matrixIndex] / 60)
        // Haversine just for the km display
        const prev = i === 0 ? depotCoord! : { lat: optimizedVisits[i - 1].lat, lng: optimizedVisits[i - 1].lng }
        distKm = Math.round(haversineKm(prev, { lat: v.lat, lng: v.lng }) * 10) / 10
      } else {
        // Haversine fallback
        const prev = i === 0 ? depotCoord! : { lat: optimizedVisits[i - 1].lat, lng: optimizedVisits[i - 1].lng }
        distKm = Math.round(haversineKm(prev, { lat: v.lat, lng: v.lng }) * 10) / 10
        driveMin = Math.round((distKm / avgSpeedKmh) * 60)
      }

      elapsedMin += driveMin
      const eta = fmtTimeClient(elapsedMin)
      const startAtISO = date ? toISOLocalClient(date, elapsedMin) : null
      const endAtISO = date ? toISOLocalClient(date, elapsedMin + v.onSiteMinutes) : null
      elapsedMin += v.onSiteMinutes
      prevMatrixIdx = v.matrixIndex

      return { ...v, stopNumber: i + 1, driveMinutes: driveMin, distanceKm: distKm, eta, startAtISO, endAtISO }
    })

    setOptimizedVisits(recalculated)
    setIsManualOrder(false)
    setSendResults(null)
    setSendError(null)
  }

  async function printRouteSheet() {
    if (!optimizedVisits || optimizedVisits.length === 0) return
    const techName = users.find(u => u.id === selectedUserId)?.name ?? 'Unknown Tech'
    const dateFormatted = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    })
    const totalDriveMin = optimizedVisits.reduce((s, v) => s + v.driveMinutes, 0)
    const totalMiles = (optimizedVisits.reduce((s, v) => s + v.distanceKm, 0) / 1.609).toFixed(1)
    const totalRevenue = optimizedVisits.reduce((s, v) => s + v.totalPrice, 0)
    const driveHours = Math.floor(totalDriveMin / 60)
    const driveRemMin = totalDriveMin % 60
    const driveSummary = driveHours > 0
      ? `${driveHours} hr ${driveRemMin} min (${totalDriveMin} min)`
      : `${totalDriveMin} min`

    // ── Mapbox GL JS map (embedded in the route sheet HTML) ──
    const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

    // ── Mapbox Static Image URL (for @media print — GL JS canvas doesn't print) ──
    let staticMapUrl = ''
    if (mapboxToken && depotCoord) {
      const waypoints = [depotCoord, ...optimizedVisits.map(v => ({ lat: v.lat, lng: v.lng }))]
      const polyline = encodePolyline5(waypoints)
      const pathOverlay = `path-3+1f77b4-0.85(${encodeURIComponent(polyline)})`
      const depotMarker = `pin-s-d+16a34a(${depotCoord.lng.toFixed(6)},${depotCoord.lat.toFixed(6)})`
      const stopMarkers = optimizedVisits.map((v, i) => {
        const label = i < 9 ? String(i + 1) : String.fromCharCode(97 + (i - 9))
        return `pin-s-${label}+c0392b(${v.lng.toFixed(6)},${v.lat.toFixed(6)})`
      })
      const overlays = [pathOverlay, depotMarker, ...stopMarkers].join(',')
      staticMapUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays}/auto/800x460@2x?padding=40&access_token=${mapboxToken}`
    }

    // Screen: GL JS container + hidden static image (shown only for print)
    const mapHtml = (mapboxToken && depotCoord)
      ? `<div id="route-map" style="width:100%;height:460px;"></div>
         ${staticMapUrl ? `<img class="print-map-img" src="${staticMapUrl}" alt="Route map">` : ''}`
      : `<div class="map-unavailable">Configure depot in Settings to enable map</div>`

    // Fetch actual road geometry from Mapbox Directions API (falls back to straight line)
    let roadCoords: number[][] | null = null
    if (mapboxToken && depotCoord) {
      try {
        const allPts = [depotCoord, ...optimizedVisits.map(v => ({ lng: v.lng, lat: v.lat }))]
        if (allPts.length <= 25) {
          const coordStr = allPts.map(p => `${p.lng},${p.lat}`).join(';')
          const dirUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?geometries=geojson&overview=full&access_token=${mapboxToken}`
          const dirRes = await fetch(dirUrl, { signal: AbortSignal.timeout(8000) })
          const dirData = await dirRes.json() as { code: string; routes?: Array<{ geometry: { coordinates: number[][] } }> }
          if (dirData.code === 'Ok' && dirData.routes?.[0]?.geometry?.coordinates) {
            roadCoords = dirData.routes[0].geometry.coordinates
          }
        }
      } catch {
        // fall through to straight-line
      }
    }

    // Scripts placed at bottom of body so #route-map is in the DOM with full dimensions
    const mapScripts = (mapboxToken && depotCoord) ? (() => {
      const depot = [depotCoord.lng, depotCoord.lat]
      const stops = optimizedVisits.map(v => [v.lng, v.lat])
      // Use road geometry if available, otherwise fall back to straight waypoints
      const routeCoords = roadCoords ? JSON.stringify(roadCoords) : JSON.stringify([depot, ...stops])
      const stopsJson = JSON.stringify(stops)
      const stopLabels = JSON.stringify(optimizedVisits.map((_, i) =>
        i < 9 ? String(i + 1) : String.fromCharCode(97 + (i - 9))
      ))
      const lngs = [depot[0], ...stops.map((s: number[]) => s[0])]
      const lats = [depot[1], ...stops.map((s: number[]) => s[1])]
      const bbox = JSON.stringify([
        [Math.min(...lngs) - 0.005, Math.min(...lats) - 0.005],
        [Math.max(...lngs) + 0.005, Math.max(...lats) + 0.005],
      ])
      return `
  <link href="https://api.mapbox.com/mapbox-gl-js/v3.0.0/mapbox-gl.css" rel="stylesheet">
  <script src="https://api.mapbox.com/mapbox-gl-js/v3.0.0/mapbox-gl.js"><\/script>
  <script>
    mapboxgl.accessToken = '${mapboxToken}';
    var map = new mapboxgl.Map({
      container: 'route-map',
      style: 'mapbox://styles/mapbox/streets-v12',
      bounds: ${bbox},
      fitBoundsOptions: { padding: 55 }
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.on('load', function() {
      map.addSource('route', { type: 'geojson', data: {
        type: 'Feature', geometry: { type: 'LineString', coordinates: ${routeCoords} }
      }});
      map.addLayer({ id: 'route-line', type: 'line', source: 'route',
        paint: { 'line-color': '#1f77b4', 'line-width': 3, 'line-opacity': 0.85 }
      });
      var depotEl = document.createElement('div');
      depotEl.innerHTML = '<div style="background:#16a34a;color:white;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:14px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35)">D<\\/div>';
      new mapboxgl.Marker({ element: depotEl, anchor: 'center' }).setLngLat(${JSON.stringify(depot)}).addTo(map);
      ${stops.map((s: number[], i: number) => {
        const label = i < 9 ? String(i + 1) : String.fromCharCode(97 + (i - 9))
        return `var el${i} = document.createElement('div');
      el${i}.innerHTML = '<div style="background:#c0392b;color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:13px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35)">${label}<\\/div>';
      new mapboxgl.Marker({ element: el${i}, anchor: 'center' }).setLngLat(${JSON.stringify(s)}).addTo(map);`
      }).join('\n      ')}
    });
  <\/script>`
    })() : ''

    // Page 1: summary stop list
    const summaryRows = optimizedVisits.map(v => `
      <tr>
        <td class="sl-num"><span class="sl-circle">${v.stopNumber}</span></td>
        <td class="sl-name">${v.clientName}</td>
        <td class="sl-addr">${v.addressString}</td>
        <td class="sl-eta">${v.eta ?? ''}</td>
      </tr>`).join('')

    // Pages 2+: detailed stop cards
    const cardHtml = optimizedVisits.map(v => {
      const instructionsHtml = v.instructions
        ? `<div class="instr-box">${v.instructions}</div>`
        : ''

      const liRows = v.lineItems.length > 0
        ? v.lineItems.map(li => {
            const unitPriceStr = li.unitPrice > 0 ? `$${li.unitPrice.toFixed(li.unitPrice < 1 ? 3 : 2)}` : '—'
            const qtyStr = li.qty !== 1 ? li.qty.toLocaleString() : '1'
            return `<tr>
              <td class="li-name">${li.name}</td>
              <td class="li-qty">${qtyStr}</td>
              <td class="li-rate">${unitPriceStr}</td>
              <td class="li-amt">$${li.totalPrice.toFixed(2)}</td>
            </tr>`
          }).join('')
        : `<tr><td class="li-name" colspan="3">${v.services || '—'}</td><td class="li-amt">$${v.totalPrice.toFixed(2)}</td></tr>`

      return `
      <div class="card">
        <div class="card-header">
          <span class="card-circle">${v.stopNumber}</span>
          <div class="card-title-block">
            <div class="card-client">${v.clientName}</div>
            <div class="card-jobtitle">${v.jobTitle}</div>
          </div>
          ${v.eta ? `<div class="card-appt">${v.eta}</div>` : ''}
        </div>
        <div class="card-meta">
          <div class="card-meta-col">
            <div class="meta-label">ADDRESS</div>
            <div class="meta-val">${v.addressString}</div>
          </div>
          <div class="card-meta-col">
            <div class="meta-label">PHONE</div>
            <div class="meta-val">${v.phone ?? '—'}</div>
          </div>
          <div class="card-meta-col card-meta-col--narrow">
            <div class="meta-label">DRIVE</div>
            <div class="meta-val">${v.driveMinutes} min</div>
          </div>
          <div class="card-meta-col card-meta-col--narrow">
            <div class="meta-label">ON-SITE</div>
            <div class="meta-val">${v.onSiteMinutes} min</div>
          </div>
        </div>
        ${instructionsHtml}
        <table class="li-table">
          <thead>
            <tr>
              <th class="li-name">SERVICE / LINE ITEM</th>
              <th class="li-qty">QTY</th>
              <th class="li-rate">RATE</th>
              <th class="li-amt">AMOUNT</th>
            </tr>
          </thead>
          <tbody>${liRows}</tbody>
          <tfoot>
            <tr class="li-total">
              <td colspan="3">JOB TOTAL</td>
              <td>$${v.totalPrice.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
        <div class="field-notes-label">FIELD NOTES</div>
        <div class="field-lines"></div>
      </div>`
    }).join('')

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Route Sheet &mdash; ${techName} &mdash; ${date}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 13px; }
    .print-btn { background: #f97316; color: #fff; border: none; padding: 10px 22px;
      border-radius: 8px; font-size: 14px; cursor: pointer; margin: 16px 24px; display: block; }

    /* Static map image: hidden on screen, shown only for print */
    .print-map-img { display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; }

    @media print {
      .print-btn { display: none !important; }

      /* Page 1 landscape (map + summary), remaining pages portrait */
      @page { size: letter portrait; margin: 0.5in; }
      @page landscape-page { size: letter landscape; margin: 0.5in; }
      .summary { page: landscape-page; }
      .cards { page: portrait; }

      /* Allow stop list to expand beyond fixed height when printing */
      .summary-body { height: auto; }
      .stoplist-panel { overflow: visible; }

      /* Swap GL JS canvas (can't print) for static image */
      #route-map { display: none !important; }
      .print-map-img { display: block; }
    }

    /* ── Page 1: Summary ── */
    .summary { page-break-after: always; }
    .summary-header { background: #0f1f3d; color: #fff; padding: 14px 18px;
      display: flex; justify-content: space-between; align-items: baseline; }
    .summary-header h1 { font-size: 18px; font-weight: bold; }
    .summary-header .sh-meta { font-size: 12px; color: #9ca3af; }
    .summary-subhead { background: #e5e7eb; padding: 6px 18px; font-size: 11px;
      color: #374151; text-align: right; }
    .summary-body { display: flex; height: 460px; border-top: 1px solid #d1d5db; }
    .map-panel { flex: 0 0 60%; border-right: 1px solid #d1d5db; overflow: hidden;
      position: relative; }
    .map-unavailable { width: 100%; height: 100%; display: flex; align-items: center;
      justify-content: center; font-size: 12px; color: #9ca3af;
      background: #f9fafb; padding: 24px; text-align: center; }
    .stoplist-panel { flex: 1; overflow: hidden; }
    .depot-row { background: #f9fafb; padding: 8px 14px; font-size: 12px;
      color: #16a34a; font-weight: bold; border-bottom: 1px solid #d1d5db; }
    .stop-list { width: 100%; border-collapse: collapse; }
    .stop-list tr { border-bottom: 1px solid #e5e7eb; }
    .stop-list tr:nth-child(even) { background: #f9fafb; }
    .sl-num { width: 40px; padding: 7px 4px 7px 12px; }
    .sl-circle { display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border-radius: 50%; background: #c0392b;
      color: #fff; font-size: 11px; font-weight: bold; }
    .sl-name { font-weight: bold; font-size: 12px; padding: 7px 4px; }
    .sl-addr { font-size: 11px; color: #555; padding: 7px 4px; }
    .sl-eta { font-size: 11px; color: #ea580c; padding: 7px 12px 7px 4px;
      white-space: nowrap; }

    /* ── Stop cards ── */
    .cards { padding: 0 24px 24px; }
    .card { margin-bottom: 28px; page-break-inside: avoid; border: 1px solid #d1d5db; }
    .card-header { background: #0f1f3d; color: #fff; padding: 10px 14px;
      display: flex; align-items: center; gap: 12px; }
    .card-circle { display: inline-flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 50%; background: #c0392b;
      color: #fff; font-size: 15px; font-weight: bold; flex-shrink: 0; }
    .card-title-block { flex: 1; min-width: 0; }
    .card-client { font-size: 15px; font-weight: bold; line-height: 1.2; }
    .card-jobtitle { font-size: 15px; color: #e5e7eb; margin-top: 3px; font-weight: 600; letter-spacing: 0.02em; }
    .card-appt { font-size: 13px; color: #fbbf24; font-weight: bold;
      flex-shrink: 0; white-space: nowrap; }
    .card-meta { display: flex; gap: 0; border-bottom: 1px solid #e5e7eb; }
    .card-meta-col { flex: 1; padding: 8px 14px; }
    .card-meta-col + .card-meta-col { border-left: 1px solid #e5e7eb; }
    .card-meta-col--narrow { flex: 0 0 80px; }
    .meta-label { font-size: 10px; color: #9ca3af; font-weight: bold;
      letter-spacing: 0.05em; margin-bottom: 2px; }
    .meta-val { font-size: 12px; }
    .instr-box { background: #f0fdf4; border: 1px solid #86efac; color: #166534;
      padding: 7px 14px; font-size: 12px; border-left: 3px solid #16a34a; }
    .li-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .li-table thead tr { background: #0f1f3d; color: #fff; }
    .li-table thead th { padding: 6px 10px; text-align: left; font-size: 10px;
      font-weight: bold; letter-spacing: 0.04em; }
    .li-table tbody tr { border-bottom: 1px solid #e5e7eb; }
    .li-table tbody tr:nth-child(even) { background: #f9fafb; }
    .li-table td { padding: 5px 10px; }
    .li-qty, .li-rate, .li-amt { width: 70px; text-align: right; white-space: nowrap; }
    .li-name { text-align: left; }
    .li-total { font-weight: bold; background: #1e3a5f !important;
      color: #fff; border-top: 2px solid #0f1f3d; }
    .li-total td { padding: 6px 10px; text-align: right; }
    .li-total td:first-child { text-align: left; font-size: 11px;
      letter-spacing: 0.04em; }
    .field-notes-label { padding: 6px 14px 2px; font-size: 10px; color: #9ca3af;
      font-weight: bold; letter-spacing: 0.05em; }
    .field-lines { height: 48px; border-top: 1px solid #e5e7eb;
      background: repeating-linear-gradient(
        to bottom, transparent, transparent 23px, #e5e7eb 23px, #e5e7eb 24px
      ); margin: 0 14px 10px; }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">&#x1F5A8;&nbsp; Print / Save as PDF</button>

  <!-- Page 1: Summary -->
  <div class="summary">
    <div class="summary-header">
      <h1>${techName} &mdash; Route Sheet</h1>
      <span class="sh-meta">${dateFormatted}</span>
    </div>
    <div class="summary-subhead">
      ${driveSummary} &nbsp;|&nbsp; ${totalMiles} miles &nbsp;|&nbsp; ${optimizedVisits.length} Stops
      ${totalRevenue > 0 ? ` &nbsp;|&nbsp; $${totalRevenue.toFixed(2)}` : ''}
    </div>
    <div class="summary-body">
      <div class="map-panel">${mapHtml}</div>
      <div class="stoplist-panel">
        <div class="depot-row">&#x25A0; DEPOT</div>
        <table class="stop-list">
          <tbody>${summaryRows}</tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Pages 2+: Stop cards -->
  <div class="cards">${cardHtml}</div>
${mapScripts}
</body>
</html>`

    const blob = new Blob([html], { type: 'text/html' })
    const blobUrl = URL.createObjectURL(blob)
    window.open(blobUrl, '_blank')
    // Revoke after enough time for the page to load
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000)
  }

  const displayVisits = optimizedVisits ?? visits
  const sendResultMap = new Map(sendResults?.map(r => [r.visitId, r]) ?? [])
  const sendSuccessCount = sendResults?.filter(r => r.success).length ?? 0
  const sendAllOk = sendResults !== null && sendResults.every(r => r.success)

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h3 className="font-semibold text-lg mb-4">Quick Route</h3>
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Date picker */}
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); setOptimizedVisits(null); setSendResults(null) }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          {/* Tech dropdown */}
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1">Team Member</label>
            {usersLoading ? (
              <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-500">
                Loading users…
              </div>
            ) : usersError ? (
              <div className="text-red-400 text-sm py-2">Error: {usersError}</div>
            ) : (
              <select
                value={selectedUserId}
                onChange={e => setSelectedUserId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              >
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Start time */}
          <div className="w-32">
            <label className="block text-xs text-gray-400 mb-1">Start Time</label>
            <input
              type="time"
              value={startTime}
              onChange={e => { setStartTime(e.target.value); setOptimizedVisits(null); setSendResults(null) }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          {/* Duration method */}
          <div className="w-36">
            <label className="block text-xs text-gray-400 mb-1">Duration</label>
            <select
              value={durationMethod}
              onChange={e => setDurationMethod(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            >
              <option value="default">Default</option>
              <option value="formula">Formula</option>
            </select>
          </div>

          {/* Load button */}
          <div className="flex items-end">
            <button
              onClick={loadVisits}
              disabled={visitsLoading || !selectedUserId}
              className="w-full sm:w-auto px-5 py-2 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {visitsLoading ? 'Loading…' : 'Load Visits'}
            </button>
          </div>
        </div>
      </div>

      {/* Errors */}
      {visitsError && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
          {visitsError}
        </div>
      )}
      {optimizeError && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
          Optimization failed: {optimizeError}
        </div>
      )}
      {geocodeFailed.length > 0 && visits && (
        <div className="bg-yellow-900/40 border border-yellow-700 text-yellow-300 rounded-lg px-4 py-3 text-sm">
          Could not geocode {geocodeFailed.length} address{geocodeFailed.length !== 1 ? 'es' : ''}
          {' '}({geocodeFailed.map(i => visits[i]?.clientName).join(', ')}) — those stops were excluded from optimization.
        </div>
      )}
      {fallbackStops.length > 0 && (
        <div className="bg-yellow-900/40 border border-yellow-700 text-yellow-300 rounded-lg px-4 py-3 text-sm">
          ⚠️ Duration fallback used for: {fallbackStops.join(', ')} — no matching line items found. Check Duration Rules in Settings.
        </div>
      )}

      {/* Visit list */}
      {displayVisits !== null && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold">
                {displayVisits.length === 0
                  ? 'No visits found'
                  : `${displayVisits.length} stop${displayVisits.length !== 1 ? 's' : ''}`}
              </h3>
              {optimizedVisits && (
                <span className="text-xs bg-green-900/50 text-green-400 border border-green-800 px-2 py-0.5 rounded-full">
                  Optimized
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {displayVisits.length > 0 && (
                <span className="text-xs text-gray-500">
                  ${displayVisits.reduce((s, v) => s + v.totalPrice, 0).toFixed(2)} total
                </span>
              )}
              {visits && !optimizedVisits && (lockedFirstId || lockedLastId) && (
                <span className="text-xs text-gray-400">
                  {[lockedFirstId && '📌 1st', lockedLastId && '📌 Last'].filter(Boolean).join(' · ')}
                </span>
              )}
              {visits && visits.length > 1 && !optimizedVisits && (
                <button
                  onClick={optimizeRoute}
                  disabled={optimizing}
                  className="px-4 py-1.5 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  {optimizing ? 'Optimizing…' : '⚡ Optimize Route'}
                </button>
              )}
              {optimizedVisits && usingMatrix !== null && (
                <span
                  title={usingMatrix ? 'Drive times use real road routes (Mapbox Matrix API)' : 'Drive times use straight-line distance — Matrix API unavailable'}
                  className={`text-xs px-2 py-1 rounded-full font-medium ${usingMatrix ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}
                >
                  {usingMatrix ? '🗺 Road times' : '📐 Straight-line'}
                </span>
              )}
              {optimizedVisits && isManualOrder && (
                <button
                  onClick={recalculateETAs}
                  className="px-4 py-1.5 bg-orange-500 hover:bg-orange-400 text-white rounded-lg text-xs font-medium transition-colors animate-pulse"
                >
                  ⚡ Recalculate
                </button>
              )}
              {optimizedVisits && !sendResults && (
                <button
                  onClick={() => { setOptimizedVisits(null); setGeocodeFailed([]); setUsingMatrix(null); setDurationMatrix(null); setIsManualOrder(false); setPreviewMapUrl(null) }}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-xs font-medium transition-colors"
                >
                  Reset Order
                </button>
              )}
              {optimizedVisits && optimizedVisits.length > 0 && (
                <button
                  onClick={printRouteSheet}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-xs font-medium transition-colors"
                >
                  📄 Route Sheet
                </button>
              )}
            </div>
          </div>

          {displayVisits.length === 0 ? (
            <p className="px-6 py-8 text-gray-500 text-sm text-center">
              No visits scheduled for this tech on this date.
            </p>
          ) : (
            <ul className="divide-y divide-gray-800">
              {displayVisits.map((v, idx) => {
                const optimized = v as OptimizedVisit
                const hasEta = 'eta' in v && optimized.eta
                const result = sendResultMap.get(v.id)
                const isDragging = draggingIdx === idx
                const isDragTarget = dragOverIdx === idx && draggingIdx !== idx
                return (
                  <li
                    key={v.id}
                    draggable={!!optimizedVisits}
                    onDragStart={optimizedVisits ? () => setDraggingIdx(idx) : undefined}
                    onDragOver={optimizedVisits ? (e) => { e.preventDefault(); setDragOverIdx(idx) } : undefined}
                    onDrop={optimizedVisits ? (e) => {
                      e.preventDefault()
                      if (draggingIdx === null || draggingIdx === idx) { setDragOverIdx(null); return }
                      const newList = [...optimizedVisits]
                      const [moved] = newList.splice(draggingIdx, 1)
                      newList.splice(idx, 0, moved)
                      setOptimizedVisits(newList.map((s, i) => ({ ...s, stopNumber: i + 1 })))
                      setIsManualOrder(true)
                      setDraggingIdx(null)
                      setDragOverIdx(null)
                    } : undefined}
                    onDragEnd={optimizedVisits ? () => { setDraggingIdx(null); setDragOverIdx(null) } : undefined}
                    className={[
                      'px-6 py-4 flex gap-4 items-start transition-opacity',
                      isDragging ? 'opacity-30' : 'opacity-100',
                      isDragTarget ? 'border-t-2 border-orange-500' : '',
                      optimizedVisits ? 'cursor-grab active:cursor-grabbing' : '',
                    ].join(' ')}
                  >
                    {optimizedVisits && (
                      <span className="text-gray-600 shrink-0 mt-1 select-none text-lg leading-none" title="Drag to reorder">⠿</span>
                    )}
                    <span className="text-2xl font-bold text-gray-600 w-8 shrink-0 text-right mt-0.5">
                      {v.stopNumber}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-white truncate">{v.clientName}</p>
                        {v.type === 'assessment' && (
                          <span className="shrink-0 text-xs bg-blue-900/50 text-blue-300 border border-blue-700 px-1.5 py-0.5 rounded">
                            📋 Assessment
                          </span>
                        )}
                      </div>
                      {v.jobTitle && (
                        <p className="text-sm text-orange-300 truncate">{v.jobTitle}</p>
                      )}
                      <p className="text-sm text-gray-400 truncate">{v.addressString}</p>
                      {v.services && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{v.services}</p>
                      )}
                      {hasEta && (
                        <p className="text-xs text-orange-400 mt-1">
                          ⏱ {optimized.driveMinutes} min drive · {optimized.onSiteMinutes} min on-site · arrive ~{optimized.eta}
                        </p>
                      )}
                      {result && !result.success && (
                        <p className="text-xs text-red-400 mt-1">✗ {result.error}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {v.totalPrice > 0 && (
                        <span className="text-sm text-gray-400">${v.totalPrice.toFixed(2)}</span>
                      )}
                      {result?.success && <span className="text-green-400 text-sm">✓</span>}
                      {result && !result.success && <span className="text-red-400 text-sm">✗</span>}
                      {visits && !optimizedVisits && (
                        <>
                          <button
                            onClick={() => setLockedFirstId(lockedFirstId === v.id ? null : v.id)}
                            title="Pin as first stop"
                            className={`text-xs px-2 py-0.5 rounded font-medium transition-colors ${
                              lockedFirstId === v.id
                                ? 'bg-green-600 text-white'
                                : 'bg-gray-700 text-gray-400 hover:text-gray-200'
                            }`}
                          >
                            1st
                          </button>
                          <button
                            onClick={() => setLockedLastId(lockedLastId === v.id ? null : v.id)}
                            title="Pin as last stop"
                            className={`text-xs px-2 py-0.5 rounded font-medium transition-colors ${
                              lockedLastId === v.id
                                ? 'bg-orange-600 text-white'
                                : 'bg-gray-700 text-gray-400 hover:text-gray-200'
                            }`}
                          >
                            Last
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* Route Map Preview */}
      {optimizedVisits && previewMapUrl && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-800 flex items-center justify-between">
            <h3 className="font-semibold text-sm">Route Preview</h3>
            <span className="text-xs text-gray-500">Same map that appears on the route sheet</span>
          </div>
          <img
            src={previewMapUrl}
            alt="Optimized route map preview"
            className="w-full block"
          />
        </div>
      )}

      {/* Send to Jobber panel */}
      {optimizedVisits && optimizedVisits.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h3 className="font-semibold text-lg mb-1">Send to Jobber</h3>
          <p className="text-sm text-gray-400 mb-4">
            Sets appointment times on each visit in Jobber based on the optimized order.
          </p>

          {sendAllOk && (
            <div className="mb-4 bg-green-900/40 border border-green-700 text-green-300 rounded-lg px-4 py-3 text-sm">
              ✓ {sendSuccessCount}/{sendResults!.length} visits updated in Jobber
            </div>
          )}
          {sendResults && !sendAllOk && (
            <div className="mb-4 bg-yellow-900/40 border border-yellow-700 text-yellow-300 rounded-lg px-4 py-3 text-sm">
              {sendSuccessCount}/{sendResults.length} updated — {sendResults.length - sendSuccessCount} failed (see stops above)
            </div>
          )}
          {sendError && (
            <div className="mb-4 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
              {sendError}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Reassign to</label>
              <select
                value={reassignUserId}
                onChange={e => setReassignUserId(e.target.value)}
                disabled={sending || sendAllOk}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 disabled:opacity-50"
              >
                <option value="__keep__">Keep current assignment</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            <button
              onClick={sendToJobber}
              disabled={sending || sendAllOk}
              className="px-6 py-2 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
            >
              {sending ? 'Sending…' : sendAllOk ? '✓ Sent' : sendResults ? 'Retry Failed' : 'Send to Jobber →'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
