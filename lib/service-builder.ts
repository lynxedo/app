// lib/service-builder.ts
// Shared types + the costing/margin math for the Service Builder (Master PRD Session 4).
//
// This is the DB-backed port of Pricer/pricer-builder.html. It implements §7 of
// PRODUCTS_PRICING_AND_OPS_MASTER_PRD.md exactly:
//   • product cost / 1,000 sq ft  (reuses costPer1000, with the per-gallon tank-ratio path)
//   • round cost/K = Σ product cost/K   ·   annual product/K = Σ round cost/K
//   • tiered labor   ·   COGS   ·   GP margin   ·   per-treatment = annual ÷ visits (computed)
//
// The Builder writes program_price_charts rows; the Pricer (Session 5) reads the
// published ones. Keep these shapes stable.

import type { Product } from '@/lib/products'
import { costPer1000 } from '@/lib/products'

// Tank ratio (locked fact §6): 2 gallons of mix per 1,000 sq ft. Used to convert a
// per-gallon product rate into a cost per 1,000 sq ft. Editable per program via
// builder_settings.tankGalPerK so nothing is silently hardcoded.
export const DEFAULT_TANK_GAL_PER_K = 2

export type ChartStatus = 'draft' | 'published' | 'archived'

export const STATUS_LABELS: Record<ChartStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
}

// One round inside a program version: a named treatment with the products applied.
export type BuilderRound = {
  id: string
  name: string
  product_ids: string[]
}

// UI-only inputs that don't belong on the pricing formula but should persist per version.
export type BuilderSettings = {
  sizes: number[] // lawn sizes (K) shown in the price chart
  avgMin: number // averages-across-range, from (K)
  avgMax: number // averages-across-range, to (K)
  targetGp: number // target-margin helper: target GP %
  targetSize: number // target-margin helper: at size (K)
  tankGalPerK: number // gal of mix per 1,000 sq ft for per-gallon products (default 2)
}

export function defaultBuilderSettings(): BuilderSettings {
  return {
    sizes: [3, 5, 10, 15, 20, 25, 30, 40],
    avgMin: 5,
    avgMax: 40,
    targetGp: 80,
    targetSize: 10,
    tankGalPerK: DEFAULT_TANK_GAL_PER_K,
  }
}

// A full program version — one row of program_price_charts.
export type PriceChart = {
  id: string
  company_id: string
  program_key: string
  name: string
  description: string | null
  version_label: string | null
  status: ChartStatus
  effective_from: string | null
  visits: number | null
  base_fee: number | null
  price_per_k: number | null
  labor_rate: number | null
  min_low: number | null
  min_high: number | null
  threshold: number | null
  rounds: BuilderRound[] | null
  builder_settings: BuilderSettings | null
  margin_snapshot: MarginSnapshot | null
  is_published: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}

// Snapshot stored on publish for audit (§8.5).
export type MarginSnapshot = {
  computed_at: string
  annual_product_per_k: number
  reference: { sizeK: number; gp: number; prodPct: number; laborPct: number }[]
}

// ---------------------------------------------------------------------------
// Product cost / 1,000 sq ft — the Builder path.
// ---------------------------------------------------------------------------
// per_1000sqft  → price ÷ (size ÷ rate)               (matches the sheet)
// per_gallon    → (rate × galPerK) × (price ÷ size)    (apply the 2 gal/K tank ratio)
// per_tree/other → not expressible per 1,000 sq ft → null (UI flags it, excluded from sums)
export function productCostPerK(p: Product, galPerK = DEFAULT_TANK_GAL_PER_K): number | null {
  if (p.rate_basis === 'per_1000sqft') {
    return costPer1000(p.package_price, p.package_size, p.application_rate)
  }
  if (p.rate_basis === 'per_gallon') {
    const { package_price: price, package_size: size, application_rate: rate } = p
    if (price == null || size == null || rate == null) return null
    if (!isFinite(price) || !isFinite(size) || !isFinite(rate) || size === 0) return null
    return rate * galPerK * (price / size)
  }
  return null // per_tree / other — not a standard per-K product
}

// ---------------------------------------------------------------------------
// Program aggregations.
// ---------------------------------------------------------------------------
export function roundCostPerK(
  round: BuilderRound,
  productById: (id: string) => Product | undefined,
  galPerK = DEFAULT_TANK_GAL_PER_K,
): number {
  return round.product_ids.reduce((sum, pid) => {
    const p = productById(pid)
    const c = p ? productCostPerK(p, galPerK) : null
    return sum + (c ?? 0)
  }, 0)
}

export function annualProductPerK(
  chart: Pick<PriceChart, 'rounds'>,
  productById: (id: string) => Product | undefined,
  galPerK = DEFAULT_TANK_GAL_PER_K,
): number {
  return (chart.rounds ?? []).reduce((sum, r) => sum + roundCostPerK(r, productById, galPerK), 0)
}

export function minutesPerK(chart: Pick<PriceChart, 'threshold' | 'min_low' | 'min_high'>, sizeK: number): number {
  const threshold = chart.threshold ?? 0
  return sizeK <= threshold ? (chart.min_low ?? 0) : (chart.min_high ?? 0)
}

export type SizeMetrics = {
  K: number
  annProduct: number
  annLabor: number
  cogs: number
  perVisit: number
  annPrice: number
  gp: number
  prodPct: number
  laborPct: number
  perTreatment: number
}

// Everything for one lawn size — the price-chart row.
export function metricsAt(
  chart: PriceChart,
  K: number,
  productById: (id: string) => Product | undefined,
): SizeMetrics {
  const galPerK = chart.builder_settings?.tankGalPerK ?? DEFAULT_TANK_GAL_PER_K
  const visits = chart.visits ?? 0
  const base = chart.base_fee ?? 0
  const perK = chart.price_per_k ?? 0
  const laborRate = chart.labor_rate ?? 0

  const annProduct = annualProductPerK(chart, productById, galPerK) * K
  const annLabor = (K * minutesPerK(chart, K)) / 60 * laborRate * visits
  const cogs = annProduct + annLabor
  const perVisit = base + perK * K
  const annPrice = perVisit * visits
  const gp = annPrice > 0 ? (annPrice - cogs) / annPrice : 0
  const prodPct = annPrice > 0 ? annProduct / annPrice : 0
  const laborPct = annPrice > 0 ? annLabor / annPrice : 0
  const perTreatment = visits > 0 ? annPrice / visits : 0 // == perVisit, always computed
  return { K, annProduct, annLabor, cogs, perVisit, annPrice, gp, prodPct, laborPct, perTreatment }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------
export function slugifyProgramKey(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'program'
}

export const pct = (v: number): string => (isFinite(v) ? (v * 100).toFixed(1) + '%' : '—')
export function pctClass(v: number): 'pct-good' | 'pct-warn' | 'pct-bad' {
  return v >= 0.7 ? 'pct-good' : v >= 0.5 ? 'pct-warn' : 'pct-bad'
}

// Audit snapshot taken on publish: annual product/K + GP/product/labor % at the
// chart's reference sizes. `nowIso` is passed in (server stamps it).
export function computeMarginSnapshot(
  chart: PriceChart,
  products: Product[],
  nowIso: string,
): MarginSnapshot {
  const byId = new Map(products.map((p) => [p.id, p]))
  const productById = (id: string) => byId.get(id)
  const galPerK = chart.builder_settings?.tankGalPerK ?? DEFAULT_TANK_GAL_PER_K
  const sizes = chart.builder_settings?.sizes?.length ? chart.builder_settings.sizes : [5, 15, 40]
  return {
    computed_at: nowIso,
    annual_product_per_k: annualProductPerK(chart, productById, galPerK),
    reference: sizes.map((K) => {
      const m = metricsAt(chart, K, productById)
      return { sizeK: K, gp: m.gp, prodPct: m.prodPct, laborPct: m.laborPct }
    }),
  }
}
