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

// A product to mix, summed across the route.
export type ProductLine = {
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

/**
 * The core Part C computation. Tank overrides (Part B) map product_id → tank_number
 * for this specific route/day and win over service_products.tank_default.
 */
export function computeRouteLoadout(
  stops: RouteStopInput[],
  data: CapacityData,
  tankOverrides: Map<string, number> = new Map(),
): RouteLoadout {
  const activeMaps = data.serviceProducts.filter(sp => sp.is_active && sp.product_id)
  const productById = new Map(data.products.map(p => [p.id, p]))
  const activeTanks = [...data.tanks].filter(t => t.is_active).sort((a, b) => a.tank_number - b.tank_number)
  const tankRate = activeTanks[0]?.application_rate || DEFAULT_TANK_RATE

  // Per-product running totals.
  type Agg = { name: string; unit: string; quantity: number; ratePerK: number; tank: number | null }
  const agg = new Map<string, Agg>()
  // sq ft routed through each tank number (a stop counts once per tank it uses).
  const tankSqft = new Map<number, number>()
  const unmapped = new Set<string>()

  let totalSqft = 0
  let stopsWithSize = 0
  const stopsMissingSize: string[] = []

  function resolveTank(sp: ServiceProductMap, productId: string): number | null {
    if (tankOverrides.has(productId)) return tankOverrides.get(productId)!
    return sp.tank_default ?? null
  }

  for (const stop of stops) {
    const sizeK = parseLawnSizeK(stop.jobTitle)
    if (sizeK == null) { stopsMissingSize.push(stop.clientName); continue }
    const sqft = sizeK * 1000
    totalSqft += sqft
    stopsWithSize++

    // Resolve this stop's product set once (dedupe per product), and which tanks it uses.
    const stopProducts = new Map<string, { sp: ServiceProductMap; tank: number | null }>()
    for (const li of stop.lineItemNames) {
      const matches = activeMaps.filter(sp => matchesLineItem(sp, li))
      if (matches.length === 0) { if (li.trim()) unmapped.add(li.trim()); continue }
      for (const sp of matches) {
        const pid = sp.product_id!
        if (!stopProducts.has(pid)) stopProducts.set(pid, { sp, tank: resolveTank(sp, pid) })
      }
    }

    const tanksUsedThisStop = new Set<number>()
    for (const [pid, { sp, tank }] of stopProducts) {
      const product = productById.get(pid)
      if (!product) continue
      const baseRate = sp.application_rate ?? product.application_rate
      const ratePerK = baseRate == null ? 0
        : product.rate_basis === 'per_gallon' ? baseRate * tankRate
        : baseRate
      const unit = (sp.rate_unit || product.unit || '').trim()
      const cur = agg.get(pid) ?? { name: product.name, unit, quantity: 0, ratePerK, tank }
      cur.quantity += sizeK * ratePerK
      cur.ratePerK = ratePerK
      cur.tank = tank
      if (unit && !cur.unit) cur.unit = unit
      agg.set(pid, cur)
      if (tank != null) tanksUsedThisStop.add(tank)
    }
    for (const tn of tanksUsedThisStop) tankSqft.set(tn, (tankSqft.get(tn) ?? 0) + sqft)
  }

  const products: ProductLine[] = [...agg.entries()]
    .map(([product_id, a]) => ({ product_id, name: a.name, quantity: a.quantity, unit: a.unit, tank: a.tank, ratePerK: a.ratePerK }))
    .sort((x, y) => (x.tank ?? 99) - (y.tank ?? 99) || x.name.localeCompare(y.name))

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
