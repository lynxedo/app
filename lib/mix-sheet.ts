// lib/mix-sheet.ts
// Technician Mix Sheet — pure, dependency-light builders shared by the server
// loader and the client view. The sheet is DERIVED from the dated mixes
// (service_products, already date-filtered by selectMappingsForDate): products
// dedupe to one column per (product, rate, unit), each carrying the program tags
// of every line item that uses it. Amount = rate × lawn size (K); per-gallon
// products convert through the 2 gal/K tank ratio.

import { PROGRAMS, programForLineItem, findProgram, cleanLineItemLabel } from './programs'

export const DEFAULT_TANK_RATE = 2 // gallons of mix per 1,000 sq ft

// Default row breakpoints (sq ft in 1,000s) — the sizes from Heroes' sheet.
export const DEFAULT_MIX_ROWS: number[] = [1, 5, 10, 15, 17.5, 20, 22.5, 25, 37.5, 50, 62.5, 75, 87.5, 100]

export type MixMappingInput = {
  id: string
  jobber_line_item_name: string
  product_id: string | null
  application_rate: number | null
  rate_unit: string | null
  program: string | null
  alt_group: string | null
  show_on_mix_sheet?: boolean
}

export type MixProductInput = {
  id: string
  name: string
  unit: string | null
  application_rate: number | null
  rate_basis: string
}

export type MixColumn = {
  key: string
  productId: string
  name: string
  ratePerK: number      // amount of `unit` per 1,000 sq ft
  unit: string
  programKeys: string[] // recognized programs using this column (drives the picker)
  tags: string[]        // display tags: program abbrs, or a line-item fallback
  altGroup: string | null
}

export type MixSheetConfig = {
  period_key: string
  label: string | null
  selected_programs: string[] | null // null/empty = all
  notes: string | null
  granular_options: string | null
}

type ColAccum = MixColumn & { _progs: Set<string>; _tags: Set<string> }

// Build the deduped product columns for a set of ACTIVE (already date-filtered)
// mappings. One column per (product, effective rate, unit); a product used by
// several line items collapses into one column carrying all their tags. Products
// whose rate basis can't be expressed per-K (per_tree/other) are skipped.
export function buildMixColumns(
  mappings: MixMappingInput[],
  productsById: Map<string, MixProductInput>,
  tankRate: number = DEFAULT_TANK_RATE,
): MixColumn[] {
  const cols = new Map<string, ColAccum>()
  for (const m of mappings) {
    if (!m.product_id) continue
    if (m.show_on_mix_sheet === false) continue // excluded from the sheet only
    const p = productsById.get(m.product_id)
    if (!p) continue
    if (p.rate_basis !== 'per_1000sqft' && p.rate_basis !== 'per_gallon') continue
    const effRate = m.application_rate ?? p.application_rate
    if (effRate == null || !isFinite(effRate)) continue
    const ratePerK = p.rate_basis === 'per_gallon' ? effRate * tankRate : effRate
    const unit = (m.rate_unit || p.unit || '').trim()
    const key = `${m.product_id}|${ratePerK}|${unit}`
    const prog = findProgram(m.program) ?? programForLineItem(m.jobber_line_item_name)
    let col = cols.get(key)
    if (!col) {
      col = { key, productId: m.product_id, name: p.name, ratePerK, unit, programKeys: [], tags: [], altGroup: m.alt_group ?? null, _progs: new Set(), _tags: new Set() }
      cols.set(key, col)
    }
    if (!col.altGroup && m.alt_group) col.altGroup = m.alt_group
    if (prog) { col._progs.add(prog.key); col._tags.add(prog.abbr) }
    else {
      // No known program → a per-line-item pseudo-program (e.g. "li:Soil Revive")
      // so it's still a selectable chip and hides when not selected.
      const label = cleanLineItemLabel(m.jobber_line_item_name)
      col._progs.add(`li:${label}`); col._tags.add(label)
    }
  }

  const order = new Map(PROGRAMS.map((p, i) => [p.abbr, i]))
  const list: MixColumn[] = [...cols.values()].map(c => ({
    key: c.key, productId: c.productId, name: c.name, ratePerK: c.ratePerK, unit: c.unit, altGroup: c.altGroup,
    programKeys: [...c._progs],
    tags: [...c._tags].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b)),
  }))
  // Broadest-use first, then by name; then pull OR-group members adjacent.
  list.sort((a, b) => b.programKeys.length - a.programKeys.length || a.name.localeCompare(b.name))
  return clusterAltGroups(list)
}

// Stable reorder so columns sharing an altGroup sit next to each other.
function clusterAltGroups(cols: MixColumn[]): MixColumn[] {
  const out: MixColumn[] = []
  const used = new Set<string>()
  for (const c of cols) {
    if (used.has(c.key)) continue
    out.push(c); used.add(c.key)
    if (c.altGroup) for (const d of cols) {
      if (!used.has(d.key) && d.altGroup === c.altGroup) { out.push(d); used.add(d.key) }
    }
  }
  return out
}

// Programs/line-items present on the sheet (for the picker): recognized programs
// in registry order, then any per-line-item pseudo-programs (li:*) alphabetically.
export function programsPresent(cols: MixColumn[]): { key: string; abbr: string; name: string }[] {
  const keys = new Set<string>()
  cols.forEach(c => c.programKeys.forEach(k => keys.add(k)))
  const out: { key: string; abbr: string; name: string }[] = []
  for (const p of PROGRAMS) if (keys.has(p.key)) out.push({ key: p.key, abbr: p.abbr, name: p.name })
  for (const k of [...keys].filter(k => k.startsWith('li:')).sort()) {
    out.push({ key: k, abbr: k.slice(3), name: k.slice(3) })
  }
  return out
}

// Round for display: 2 dp, trailing zeros stripped, tabular-friendly.
export function fmtAmt(n: number): string {
  if (!isFinite(n)) return '—'
  return (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

// 'YYYY-MM' period key for a YYYY-MM-DD date string.
export function periodKeyFor(asOf: string): string {
  return asOf.slice(0, 7)
}
