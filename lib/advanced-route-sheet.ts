// Session 73.2 — Advanced Routing owns its own route-sheet HTML.
// Mirrors the Basic route sheet (RouteBuilder.generateRouteHtml) but is a pure,
// self-contained function driven by holding-batch data instead of RouteBuilder's
// live state. Kept separate on purpose: the Advanced sheet will grow extra
// sections (tank loadout, product quantities, predicted times) in 73.5–73.7,
// and Basic must stay byte-for-byte untouched.

const AVG_SPEED_KMH = 40 // matches RouteBuilder's haversine fallback default

export interface RouteSheetLineItem {
  name: string
  qty: number
  unitPrice: number
  totalPrice: number
}

export interface RouteSheetStop {
  stopNumber: number
  clientName: string
  addressString: string
  phone: string | null
  jobTitle: string
  eta: string
  driveMinutes: number
  onSiteMinutes: number
  distanceKm: number
  lat: number
  lng: number
  lineItems: RouteSheetLineItem[]
  services: string
  totalPrice: number
  instructions: string | null
}

export interface RouteSheetInput {
  techName: string
  date: string                                   // YYYY-MM-DD (assigned date)
  stops: RouteSheetStop[]
  depot: { lat: number; lng: number } | null
  mapboxToken: string
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

// Precision-5 encoded polyline for the Mapbox Static Images API path overlay.
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

/**
 * Build the full self-contained HTML route sheet for a holding-area batch.
 * Same layout/CSS as the Basic sheet so techs see a consistent document.
 * The return-to-depot leg is estimated via haversine (no Matrix cache here).
 */
export async function buildAdvancedRouteSheetHtml(input: RouteSheetInput): Promise<string> {
  const { techName, date, stops, depot, mapboxToken } = input
  if (stops.length === 0) return ''

  const dateFormatted = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  // Return-to-depot leg (haversine estimate)
  let sheetReturnMin = 0
  let sheetReturnKm = 0
  if (depot && stops.length > 0) {
    const last = stops[stops.length - 1]
    sheetReturnKm = Math.round(haversineKm({ lat: last.lat, lng: last.lng }, depot) * 10) / 10
    sheetReturnMin = Math.round((sheetReturnKm / AVG_SPEED_KMH) * 60)
  }

  const totalDriveMin = stops.reduce((s, v) => s + v.driveMinutes, 0) + sheetReturnMin
  const totalMiles = ((stops.reduce((s, v) => s + v.distanceKm, 0) + sheetReturnKm) / 1.609).toFixed(1)
  const totalRevenue = stops.reduce((s, v) => s + v.totalPrice, 0)
  const driveHours = Math.floor(totalDriveMin / 60)
  const driveRemMin = totalDriveMin % 60
  const driveSummary = driveHours > 0
    ? `${driveHours} hr ${driveRemMin} min (${totalDriveMin} min)`
    : `${totalDriveMin} min`

  // ── Mapbox Static Image URL (Directions geometry → straight-line fallback) ──
  let staticMapUrl = ''
  if (mapboxToken && depot) {
    const stopWaypoints = stops.map(v => ({ lat: v.lat, lng: v.lng }))
    const allWaypoints = [depot, ...stopWaypoints, depot]
    let pathCoords: Array<{ lat: number; lng: number }> = allWaypoints
    if (allWaypoints.length >= 2 && allWaypoints.length <= 25) {
      try {
        const coordStr = allWaypoints.map(p => `${p.lng},${p.lat}`).join(';')
        const dirRes = await fetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}` +
          `?geometries=geojson&overview=simplified&access_token=${mapboxToken}`
        )
        if (dirRes.ok) {
          const dirData = await dirRes.json() as {
            code: string
            routes?: Array<{ geometry: { coordinates: [number, number][] } }>
          }
          if (dirData.code === 'Ok' && dirData.routes?.[0]?.geometry?.coordinates?.length) {
            pathCoords = dirData.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng }))
          }
        }
      } catch {
        // fall back to straight-line waypoints
      }
    }
    const polyline = encodePolyline5(pathCoords)
    const pathOverlay = `path-3+1f77b4-0.85(${encodeURIComponent(polyline)})`
    const depotMarker = `pin-s-d+16a34a(${depot.lng.toFixed(6)},${depot.lat.toFixed(6)})`
    const stopMarkers = stops.map((v, i) => {
      const label = i < 9 ? String(i + 1) : String.fromCharCode(97 + (i - 9))
      return `pin-s-${label}+c0392b(${v.lng.toFixed(6)},${v.lat.toFixed(6)})`
    })
    const overlays = [pathOverlay, depotMarker, ...stopMarkers].join(',')
    staticMapUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays}/auto/1200x700@2x?padding=40&access_token=${mapboxToken}`
  }

  const mapHtml = staticMapUrl
    ? `<img class="route-map-img" src="${staticMapUrl}" alt="Route map">`
    : `<div class="map-unavailable">Depot not set on this batch — map unavailable</div>`

  // Page 1: summary stop list
  const returnRow = sheetReturnMin > 0
    ? `<tr>
        <td class="sl-num"><span class="sl-circle" style="background:#374151;font-size:14px">↩</span></td>
        <td class="sl-name" style="color:#6b7280">Return to depot</td>
        <td class="sl-addr" style="color:#9ca3af">${(sheetReturnKm / 1.609).toFixed(1)} mi</td>
        <td class="sl-eta" style="color:#6b7280">${sheetReturnMin} min</td>
      </tr>`
    : ''
  const summaryRows = stops.map(v => `
    <tr>
      <td class="sl-num"><span class="sl-circle">${v.stopNumber}</span></td>
      <td class="sl-name">${v.clientName}</td>
      <td class="sl-addr">${v.addressString}</td>
      <td class="sl-eta">${v.eta ?? ''}</td>
    </tr>`).join('') + returnRow

  // Pages 2+: detailed stop cards
  const cardHtml = stops.map(v => {
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Route Sheet &mdash; ${techName} &mdash; ${date}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 13px; }
    .print-btn { background: #f97316; color: #fff; border: none; padding: 10px 22px;
      border-radius: 8px; font-size: 14px; cursor: pointer; margin: 16px 24px; display: block; }
    .route-map-img { display: block; width: 100%; height: 100%; object-fit: contain; background: #f3f4f6; }
    @media print {
      .print-btn { display: none !important; }
      @page { size: letter portrait; margin: 0.5in; }
      @page landscape-page { size: letter landscape; margin: 0.5in; }
      .summary { page: landscape-page; }
      .cards { page: portrait; }
      .summary-body { height: auto; }
      .stoplist-panel { overflow: visible; }
    }
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
      ${driveSummary} &nbsp;|&nbsp; ${totalMiles} miles &nbsp;|&nbsp; ${stops.length} Stops
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
</body>
</html>`
}
