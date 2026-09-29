// Neighborhood map — which of the company's own neighborhoods an address is in.
//
// The office draws its neighborhoods as polygons in Google My Maps. An admin
// exports that map (KML or KMZ) and uploads it in Admin → AI → Knowledge; it is
// stored per company in `neighborhood_maps`. A lookup geocodes the address (the
// same cached, address-level-only geocoder the Route Optimizer uses) and tests
// the point against every polygon.
//
// ⚠ Why a map and not a zip or a city: these names are polygons, several of them
// share zip codes, and guessing from a zip has produced wrong-neighborhood job
// titles before. A point inside a drawn polygon is evidence; anything less is a
// guess, and every caller of this module must treat "no match" as "don't know".

import { inflateRawSync } from 'zlib'
import type { SupabaseClient } from '@supabase/supabase-js'
import { geocodeAddresses, type LatLng } from '@/lib/geocode'

type Ring = [number, number][] // [lng, lat]

export type NeighborhoodPolygon = { outer: Ring; holes: Ring[] }

export type NeighborhoodArea = {
  name: string
  polygons: NeighborhoodPolygon[]
  bbox: [number, number, number, number] // minLng, minLat, maxLng, maxLat
}

// ── Parsing an upload ──────────────────────────────────────────────────────────

/**
 * Pull the KML text out of a KMZ (a zip). Google My Maps exports KMZ by default;
 * a plain KML upload is passed through untouched. Only the stored and deflate
 * methods exist in practice, and those are the two handled.
 */
export function kmlTextFromUpload(buf: Buffer): string {
  const isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50
  if (!isZip) return buf.toString('utf8')

  // End of central directory: scan back from the end (it may carry a comment).
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('That KMZ file looks damaged — try exporting it again.')

  const entries = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  let best: { name: string; method: number; size: number; offset: number } | null = null
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const offset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (/\.kml$/i.test(name) && (!best || /(^|\/)doc\.kml$/i.test(name))) best = { name, method, size, offset }
    p += 46 + nameLen + extraLen + commentLen
  }
  if (!best) throw new Error('No map (.kml) was found inside that KMZ file.')

  const lh = best.offset
  const dataStart = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28)
  const raw = buf.subarray(dataStart, dataStart + best.size)
  if (best.method === 0) return raw.toString('utf8')
  if (best.method === 8) return inflateRawSync(raw).toString('utf8')
  throw new Error('That KMZ file uses a compression this upload does not read — export it as KML instead.')
}

function decodeText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function parseCoords(block: string | undefined): Ring {
  const m = block?.match(/<coordinates>([\s\S]*?)<\/coordinates>/)
  if (!m) return []
  const ring: Ring = []
  for (const tuple of m[1].trim().split(/\s+/)) {
    const [lng, lat] = tuple.split(',').map(Number)
    if (Number.isFinite(lng) && Number.isFinite(lat)) ring.push([lng, lat])
  }
  return ring
}

/**
 * Every named polygon in a KML document. Placemarks without a polygon (pins,
 * lines) are skipped, not errors — a My Maps layer often carries a few.
 * Two placemarks with the same name merge into one area.
 */
export function parseNeighborhoodKml(kml: string): NeighborhoodArea[] {
  const byName = new Map<string, NeighborhoodArea>()
  for (const pm of kml.match(/<Placemark[\s>][\s\S]*?<\/Placemark>/g) ?? []) {
    const name = decodeText(pm.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? '')
    if (!name) continue
    const polygons: NeighborhoodPolygon[] = []
    for (const poly of pm.match(/<Polygon[\s>][\s\S]*?<\/Polygon>/g) ?? []) {
      const outer = parseCoords(poly.match(/<outerBoundaryIs>([\s\S]*?)<\/outerBoundaryIs>/)?.[1])
      if (outer.length < 3) continue
      const holes = (poly.match(/<innerBoundaryIs>[\s\S]*?<\/innerBoundaryIs>/g) ?? [])
        .map(parseCoords)
        .filter((r) => r.length >= 3)
      polygons.push({ outer, holes })
    }
    if (!polygons.length) continue

    const area = byName.get(name) ?? { name, polygons: [], bbox: [Infinity, Infinity, -Infinity, -Infinity] as NeighborhoodArea['bbox'] }
    for (const poly of polygons) {
      area.polygons.push(poly)
      for (const [lng, lat] of poly.outer) {
        area.bbox = [
          Math.min(area.bbox[0], lng),
          Math.min(area.bbox[1], lat),
          Math.max(area.bbox[2], lng),
          Math.max(area.bbox[3], lat),
        ]
      }
    }
    byName.set(name, area)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ── Geometry ───────────────────────────────────────────────────────────────────

function inRing(pt: LatLng, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > pt.lat !== yj > pt.lat && pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function areaContains(area: NeighborhoodArea, pt: LatLng): boolean {
  const [a, b, c, d] = area.bbox
  if (pt.lng < a || pt.lng > c || pt.lat < b || pt.lat > d) return false
  return area.polygons.some((p) => inRing(pt, p.outer) && !p.holes.some((h) => inRing(pt, h)))
}

/** Metres from a point to an area's nearest edge (flat-earth; fine at city scale). */
export function metresToAreaEdge(area: NeighborhoodArea, pt: LatLng): number {
  const kx = 111320 * Math.cos((pt.lat * Math.PI) / 180)
  const ky = 110540
  let best = Infinity
  for (const poly of area.polygons) {
    for (const ring of [poly.outer, ...poly.holes]) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const ax = (ring[j][0] - pt.lng) * kx
        const ay = (ring[j][1] - pt.lat) * ky
        const bx = (ring[i][0] - pt.lng) * kx
        const by = (ring[i][1] - pt.lat) * ky
        const dx = bx - ax
        const dy = by - ay
        const len2 = dx * dx + dy * dy
        const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
      }
    }
  }
  return best
}

// ── Lookup ─────────────────────────────────────────────────────────────────────

/** How close (metres) to another neighborhood's edge counts as "on the border". */
const BORDER_METRES = 100

export type NeighborhoodLookup =
  | { status: 'no_map' }
  | { status: 'not_geocoded' }
  | {
      status: 'found' | 'outside' | 'overlap'
      /** Every area the point is inside (one for 'found', 2+ for 'overlap'). */
      matches: string[]
      /** Other areas whose edge is within BORDER_METRES — worth a second look. */
      nearBorder: string[]
      /** For 'outside': the closest area and how far it is. */
      nearest: { name: string; metres: number } | null
      point: LatLng
    }

export async function getNeighborhoodMap(
  admin: SupabaseClient,
  companyId: string,
): Promise<{ areas: NeighborhoodArea[]; fileName: string | null; uploadedAt: string | null } | null> {
  const { data } = await admin
    .from('neighborhood_maps')
    .select('areas, file_name, uploaded_at')
    .eq('company_id', companyId)
    .maybeSingle()
  const row = data as { areas: NeighborhoodArea[] | null; file_name: string | null; uploaded_at: string | null } | null
  if (!row || !Array.isArray(row.areas) || !row.areas.length) return null
  return { areas: row.areas, fileName: row.file_name, uploadedAt: row.uploaded_at }
}

export async function lookupNeighborhood(
  admin: SupabaseClient,
  companyId: string,
  address: string,
): Promise<NeighborhoodLookup> {
  const map = await getNeighborhoodMap(admin, companyId)
  if (!map) return { status: 'no_map' }

  const [point] = await geocodeAddresses([address])
  if (!point) return { status: 'not_geocoded' }

  const matches: string[] = []
  const others: { name: string; metres: number }[] = []
  for (const area of map.areas) {
    if (areaContains(area, point)) matches.push(area.name)
    else others.push({ name: area.name, metres: metresToAreaEdge(area, point) })
  }
  others.sort((a, b) => a.metres - b.metres)
  const nearBorder = others.filter((o) => o.metres <= BORDER_METRES).map((o) => o.name)

  return {
    status: matches.length === 1 ? 'found' : matches.length > 1 ? 'overlap' : 'outside',
    matches,
    nearBorder,
    nearest: matches.length ? null : others[0] ? { name: others[0].name, metres: Math.round(others[0].metres) } : null,
    point,
  }
}
