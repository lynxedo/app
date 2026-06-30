// lib/route-capacity.ts
// Master PRD Session 7 — Route Capacity Parts A–C.
//
// Pure, dependency-free calc shared by the server (capacity-data API) and the
// client (the tank-loadout card in Advanced Routing). Given the optimized route
// on screen + the company's tanks + line-item→product mappings, it computes:
//   • total route square footage
//   • how much of each product to mix (per-product quantity in its unit)
//   • which tank each product goes in, how full each tank gets, and overflows
//
// Square footage per stop comes from the job-title "K" suffix (e.g. "RC1 25K" =
// 25,000 sq ft) — the same source the routing duration formula already uses
// (confirmed with Ben, June 19 2026). Tank fill is driven by the SPRAY MIX, not
// the product amount: a full tank sprays `gallon_capacity ÷ gal-per-K × 1,000`
// sq ft (e.g. 180 ÷ 2 × 1,000 = 90,000 sq ft).

import { selectMappingsForDate, todayInTz } from './service-mapping'

export const DEFAULT_TANK_RATE = 2 // gallons of mix applied per 1,000 sq ft

export type MatchType = 'contains' | 'exact'

export type TankConfig = {
  id: string
  tank_number: number
  label: string | null
  gallon_capacity: number | null
  application_rate: number // gallons per 1,000 sq ft
  is_active: boolean
}

export type ServiceProductMap = {
  id: string
  jobber_line_item_name: string
  match_type: MatchType
  product_id: string | null
  application_rate: number | null // overrides the product's default rate for this line item
  rate_unit: string | null
  program: string | null
  tank_default: number | null
  effective_start: string | null
  effective_end: string | null
  batch_label: string | null
  is_active: boolean
}

export type CapacityProduct = {
  id: string
  name: string
  unit: string | null
  application_rate: number | null
  rate_basis: string // 'per_1000sqft' | 'per_gallon' | other
}

export type CapacityData = {
  tanks: TankConfig[]
  serviceProducts: ServiceProductMap[]
  products: CapacityProduct[]
}

export type RouteStopInput = {
  id: string
  clientName: string
  jobTitle: string
  lineItemNames: string[]
}

// A product to mix for ONE line item, summed across the route. The same product
// on two different line items (e.g. 4600 Anchor on both Root Rot Recovery and
// Lawn Health Complete) yields two ProductLines — each totalled on its own line
// item and assignable to its own tank (Ben, 2026-06-22). The unit is the
// service_products mapping (`service_product_id`), not the bare product.
export type ProductLine = {
  service_product_id: string // the (line item × product) mapping this line totals
  line_item: string // display label — program ?? jobber_line_item_name
  product_id: string
  name: string
  quantity: number
  unit: string
  tank: number | null // resolved tank (override → default → null)
  ratePerK: number // effective amount-per-1,000-sq-ft used in the calc
}

export type TankLoad = {
  tank_number: number
  label: string | null
  gallon_capacity: number | null
  sprayableSqft: number | null
  loadedSqft: number
  fillPct: number | null // 0–1+ (loadedSqft ÷ sprayableSqft)
  overflow: boolean
  products: ProductLine[]
}

export type RouteLoadout = {
  totalSqft: number
  stopsWithSize: number
  stopsMissingSize: string[] // client names whose job title had no parseable "K"
  products: ProductLine[]
  tanks: TankLoad[]
  untankedProducts: ProductLine[] // mapped products with no tank (e.g. dry/granular)
  unmappedLineItems: string[] // distinct line items with no active mapping
  hasMappings: boolean
}

// sq ft a full tank can spray = gallon_capacity ÷ gal-per-K × 1,000.
export function tankSprayableSqft(t: Pick<TankConfig, 'gallon_capacity' | 'application_rate'>): number | null {
  if (t.gallon_capacity == null || !t.application_rate) return null
  return (t.gallon_capacity / t.application_rate) * 1000
}

// Parse thousands-of-sq-ft from a job title, e.g. "RC1 25K" → 25. Mirrors
// parseLawnSizeK in app/api/optimize/route.ts so routing and capacity agree.
export function parseLawnSizeK(jobTitle: string | null | undefined): number | null {
  if (!jobTitle) return null
  const m = jobTitle.match(/(\d+(?:\.\d+)?)\s*[Kk](?:\s|$)/)
  return m ? parseFloat(m[1]) : null
}

function matchesLineItem(sp: ServiceProductMap, lineItem: string): boolean {
  const a = lineItem.trim().toLowerCase()
  const b = sp.jobber_line_item_name.trim().toLowerCase()
  if (!a || !b) return false
  return sp.match_type === 'exact' ? a === b : a.includes(b)
}

function lineItemLabel(sp: ServiceProductMap): string {
  return (sp.program || sp.jobber_line_item_name || '').trim()
}

/**
 * The core Part C computation. Quantities and tanks are totalled per
 * (line item × product) mapping — keyed by service_products.id — so a product
 * applied for two line items on the same stop counts twice (once per line item)
 * and each can go in its own tank. Tank overrides (Part B) map
 * service_product_id → tank_number for this route/day and win over
 * service_products.tank_default.
 */
export function computeRouteLoadout(
  stops: RouteStopInput[],
  data: CapacityData,
  tankOverrides: Map<string, number> = new Map(),
  asOf?: string,
): RouteLoadout {
  // Per line item, only the mix batch in effect on the route's date applies.
  const activeMaps = selectMappingsForDate(
    data.serviceProducts.filter(sp => sp.is_active),
    asOf ?? todayInTz(),
  ).filter(sp => sp.product_id)
  const productById = new Map(data.products.map(p => [p.id, p]))
  const activeTanks = [...data.tanks].filter(t => t.is_active).sort((a, b) => a.tank_number - b.tank_number)
  const tankRate = activeTanks[0]?.application_rate || DEFAULT_TANK_RATE

  // Per-mapping running totals (one row per line item × product).
  type Agg = { service_product_id: string; line_item: string; product_id: string; name: string; unit: string; quantity: number; ratePerK: number; tank: number | null }
  const agg = new Map<string, Agg>()
  // sq ft routed through each tank number (a stop counts once per tank it uses —
  // two line items sharing a tank = one spray pass; split tanks = one pass each).
  const tankSqft = new Map<number, number>()
  const unmapped = new Set<string>()

  let totalSqft = 0
  let stopsWithSize = 0
  const stopsMissingSize: string[] = []

  function resolveTank(sp: ServiceProductMap): number | null {
    if (tankOverrides.has(sp.id)) return tankOverrides.get(sp.id)!
    return sp.tank_default ?? null
  }

  for (const stop of stops) {
    const sizeK = parseLawnSizeK(stop.jobTitle)
    if (sizeK == null) { stopsMissingSize.push(stop.clientName); continue }
    const sqft = sizeK * 1000
    totalSqft += sqft
    stopsWithSize++

    // Which mappings fire on this stop (dedupe per mapping — a mapping applies
    // once per stop even if two of the stop's line items both match it).
    const firedThisStop = new Map<string, ServiceProductMap>()
    for (const li of stop.lineItemNames) {
      const matches = activeMaps.filter(sp => matchesLineItem(sp, li))
      if (matches.length === 0) { if (li.trim()) unmapped.add(li.trim()); continue }
      for (const sp of matches) if (!firedThisStop.has(sp.id)) firedThisStop.set(sp.id, sp)
    }

    const tanksUsedThisStop = new Set<number>()
    for (const [spId, sp] of firedThisStop) {
      const product = productById.get(sp.product_id!)
      if (!product) continue
      const tank = resolveTank(sp)
      const baseRate = sp.application_rate ?? product.application_rate
      const ratePerK = baseRate == null ? 0
        : product.rate_basis === 'per_gallon' ? baseRate * tankRate
        : baseRate
      const unit = (sp.rate_unit || product.unit || '').trim()
      const cur = agg.get(spId) ?? { service_product_id: spId, line_item: lineItemLabel(sp), product_id: sp.product_id!, name: product.name, unit, quantity: 0, ratePerK, tank }
      cur.quantity += sizeK * ratePerK
      cur.ratePerK = ratePerK
      cur.tank = tank
      if (unit && !cur.unit) cur.unit = unit
      agg.set(spId, cur)
      if (tank != null) tanksUsedThisStop.add(tank)
    }
    for (const tn of tanksUsedThisStop) tankSqft.set(tn, (tankSqft.get(tn) ?? 0) + sqft)
  }

  const products: ProductLine[] = [...agg.values()]
    .map(a => ({ service_product_id: a.service_product_id, line_item: a.line_item, product_id: a.product_id, name: a.name, quantity: a.quantity, unit: a.unit, tank: a.tank, ratePerK: a.ratePerK }))
    .sort((x, y) => (x.tank ?? 99) - (y.tank ?? 99) || x.line_item.localeCompare(y.line_item) || x.name.localeCompare(y.name))

  const tanks: TankLoad[] = activeTanks.map(t => {
    const sprayable = tankSprayableSqft(t)
    const loadedSqft = tankSqft.get(t.tank_number) ?? 0
    const fillPct = sprayable && sprayable > 0 ? loadedSqft / sprayable : null
    return {
      tank_number: t.tank_number,
      label: t.label,
      gallon_capacity: t.gallon_capacity,
      sprayableSqft: sprayable,
      loadedSqft,
      fillPct,
      overflow: fillPct != null && fillPct > 1,
      products: products.filter(p => p.tank === t.tank_number),
    }
  })

  return {
    totalSqft,
    stopsWithSize,
    stopsMissingSize,
    products,
    tanks,
    untankedProducts: products.filter(p => p.tank == null),
    unmappedLineItems: [...unmapped].sort(),
    hasMappings: activeMaps.length > 0,
  }
}

// Tidy a quantity for display: 2 decimals, no trailing zeros.
export function fmtQty(n: number): string {
  if (!isFinite(n)) return '0'
  return (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

// ── Persisted snapshot (Route Capacity Part D) ────────────────────────────────
// The shape written to daily_log_entries.route_loadout when a route is sent to
// Daily Log (PRD §8.9). It's a self-contained snapshot — Daily Log V2 only reads
// and displays it, never recomputes — so field names use snake_case to read
// naturally as stored JSON.
export type StoredLoadoutProduct = { service_product_id: string; line_item: string; product_id: string; name: string; quantity: number; unit: string; tank: number | null }
export type StoredLoadoutTank = { tank_number: number; label: string | null; gallon_capacity: number | null; sprayable_sqft: number | null; sqft_loaded: number; fill_pct: number | null; overflow: boolean }

export type StoredRouteLoadout = {
  predicted_onsite_minutes: number | null
  predicted_drive_minutes: number | null
  total_sqft: number
  has_mappings: boolean
  products: StoredLoadoutProduct[]
  tanks: StoredLoadoutTank[]
  unmapped_line_items: string[]
  stops_missing_size: string[]
  computed_at: string
}

// Map the live RouteLoadout + route totals into the persisted snapshot.
export function toStoredLoadout(
  loadout: RouteLoadout,
  opts: { predictedOnsiteMinutes?: number | null; predictedDriveMinutes?: number | null; computedAt: string },
): StoredRouteLoadout {
  return {
    predicted_onsite_minutes: opts.predictedOnsiteMinutes ?? null,
    predicted_drive_minutes: opts.predictedDriveMinutes ?? null,
    total_sqft: loadout.totalSqft,
    has_mappings: loadout.hasMappings,
    products: loadout.products.map(p => ({ service_product_id: p.service_product_id, line_item: p.line_item, product_id: p.product_id, name: p.name, quantity: p.quantity, unit: p.unit, tank: p.tank })),
    tanks: loadout.tanks.map(t => ({
      tank_number: t.tank_number, label: t.label, gallon_capacity: t.gallon_capacity,
      sprayable_sqft: t.sprayableSqft, sqft_loaded: t.loadedSqft, fill_pct: t.fillPct, overflow: t.overflow,
    })),
    unmapped_line_items: loadout.unmappedLineItems,
    stops_missing_size: loadout.stopsMissingSize,
    computed_at: opts.computedAt,
  }
}
