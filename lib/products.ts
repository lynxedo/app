// lib/products.ts
// Shared types + derivations for the Inventory / Products foundation (Session 81).
//
// 3-level model:  category (group)  ->  product (item)  ->  variant (sub-item / rate)
//   • Inventory is tracked on the ITEM, per location.
//   • Cost-per-1,000 sq ft and KSF/package are DERIVED here, never stored — they come
//     straight from Ben's spreadsheet formulas:  KSF/package = size ÷ rate,  cost/1,000 = price ÷ (size ÷ rate).
//
// Consumed downstream by the Route Capacity tool, Daily Log V2, and pesticide records,
// so keep the shapes stable. See Hub/CHEMICAL_TRACKING_PRD.md + the foundation vision doc.

export type RateBasis = 'per_1000sqft' | 'per_gallon' | 'per_tree' | 'other'

export const RATE_BASIS_LABELS: Record<RateBasis, string> = {
  per_1000sqft: 'per 1,000 sq ft',
  per_gallon: 'per gallon',
  per_tree: 'per tree',
  other: 'other',
}

export type ProductCategory = {
  id: string
  company_id: string
  name: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type InventoryLocation = {
  id: string
  company_id: string
  name: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type ProductVariant = {
  id: string
  company_id: string
  product_id: string
  label: string | null          // "High Rate", "0.2 rate", "Normal 3#"
  application_rate: number | null
  rate_basis: RateBasis
  notes: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type ProductLocationInventory = {
  id: string
  company_id: string
  product_id: string
  location_id: string
  quantity: number              // number of packages at this location
  created_at: string
  updated_at: string
}

export type Product = {
  id: string
  company_id: string
  category_id: string | null
  name: string
  description: string | null
  package_price: number | null  // cost per package (from invoices)
  package_size: number | null   // container size, in `unit`
  unit: string | null           // unit shared by package_size AND application_rate
  application_rate: number | null // amount of `unit` applied per the rate_basis (flat model)
  rate_basis: RateBasis          // 'per_1000sqft' | 'per_gallon'
  epa_reg_number: string | null
  active_ingredient: string | null
  label_url: string | null       // link to the official EPA / SDS label PDF
  notes: string | null
  batch_number: string | null
  batch_date: string | null
  reorder_threshold: number | null  // low-stock alert level, in packages (Session 10)
  is_active: boolean
  sort_order: number
  deleted_at: string | null
  created_at: string
  updated_at: string
}

// Item joined with its per-location inventory — the shape the admin grid renders.
export type ProductWithDetail = Product & {
  inventory: ProductLocationInventory[]
}

// ---------------------------------------------------------------------------
// Unit normalization — the sheet mixes '#', 'LBS', 'lbs' (all pounds).
// ---------------------------------------------------------------------------
export function normalizeUnit(raw: string | null | undefined): string {
  if (!raw) return ''
  const u = raw.trim()
  if (['#', '#s', 'LBS', 'Lbs', 'lbs', 'lb', 'pound', 'pounds'].includes(u)) return 'lbs'
  const lower = u.toLowerCase()
  if (lower === 'oz' || lower === 'ounce' || lower === 'ounces') return 'oz'
  if (lower === 'fl oz' || lower === 'floz') return 'fl oz'
  if (lower === 'g' || lower === 'gram' || lower === 'grams') return 'g'
  if (lower === 'gal' || lower === 'gallon' || lower === 'gallons') return 'gal'
  return lower
}

// ---------------------------------------------------------------------------
// Derivations — Ben's spreadsheet formulas (cols G and H of the Products sheet).
// ---------------------------------------------------------------------------

// KSF per package = package_size ÷ rate  (how many 1,000 sq ft one package covers).
export function ksfPerPackage(
  packageSize: number | null | undefined,
  rate: number | null | undefined,
): number | null {
  if (packageSize == null || rate == null) return null
  if (!isFinite(packageSize) || !isFinite(rate) || rate === 0) return null
  return packageSize / rate
}

// Cost per 1,000 sq ft = package_price ÷ (package_size ÷ rate) = package_price × rate ÷ package_size.
// Only agronomically meaningful when rate_basis = 'per_1000sqft'; the UI labels other bases.
export function costPer1000(
  packagePrice: number | null | undefined,
  packageSize: number | null | undefined,
  rate: number | null | undefined,
): number | null {
  const ksf = ksfPerPackage(packageSize, rate)
  if (ksf == null || ksf === 0) return null
  if (packagePrice == null || !isFinite(packagePrice)) return null
  return packagePrice / ksf
}

// ---------------------------------------------------------------------------
// Inventory rollups (across all locations for one item).
// ---------------------------------------------------------------------------
export function inventoryTotal(rows: { quantity: number | null }[]): number {
  return rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0)
}

// Dollar value = total packages on hand × package price.
export function inventoryValue(
  totalQty: number,
  packagePrice: number | null | undefined,
): number | null {
  if (packagePrice == null || !isFinite(packagePrice)) return null
  return totalQty * packagePrice
}

// ---------------------------------------------------------------------------
// Formatting helpers (shared by admin + future read surfaces).
// ---------------------------------------------------------------------------
export function fmtMoney(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtNum(n: number | null | undefined, maxFrac = 2): string {
  if (n == null || !isFinite(n)) return '—'
  return n.toLocaleString('en-US', { maximumFractionDigits: maxFrac })
}
