// lib/service-mapping.ts
// Types for Service Mapping (Master PRD Session 6): the line-item → product(s)
// map (service_products) and the current-round selection per program
// (product_rounds). Both tables were created in Session 2; this session adds the
// admin UI + API. Shared by client + server.

export type MatchType = 'contains' | 'exact'
export const MATCH_TYPES: MatchType[] = ['contains', 'exact']

// One mapping row: a Jobber line item resolves to a product (many rows per line
// item is normal — a service can apply several products). Drives Route Capacity
// quantities and the Pesticide record.
export type ServiceProduct = {
  id: string
  company_id: string
  jobber_line_item_name: string
  match_type: MatchType
  product_id: string | null
  application_rate: number | null // overrides the product's default rate for this line item
  rate_unit: string | null
  program: string | null
  tank_default: number | null // 1–4
  notes: string | null
  // ── dated mix batches (2026-06-30) ──
  // A line item can hold several mixes across the year; each row carries the date
  // window + OR-alternate group of the batch it belongs to. NULL dates = the
  // un-dated "always-on" batch (legacy behaviour / fallback).
  effective_start: string | null
  effective_end: string | null
  alt_group: string | null
  batch_label: string | null
  show_on_mix_sheet: boolean // false = hide from the Technician Mix Sheet only
  is_active: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}

// One round of a program, with the products applied that round. is_current marks
// the active round (at most one per program — enforced by a partial unique index).
export type ProductRound = {
  id: string
  company_id: string
  program: string
  round_label: string | null
  product_ids: string[]
  is_current: boolean
  effective_from: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

// Distinct Jobber line-item name + usage count, for the mapping autocomplete.
export type LineItemName = { name: string; uses: number }

export const TANK_OPTIONS = [1, 2, 3, 4] as const

// ── Dated mix batches ────────────────────────────────────────────────────────
// A "mix / batch" for a line item = the mapping rows that share a date window
// (and label). These helpers are pure + dependency-free so the pesticide matcher,
// the route loadout, and the admin UI all share one definition of a batch and of
// "which mix is in effect on a given day".

// Just the fields needed to identify + date-resolve a batch.
export type DatedMapping = {
  jobber_line_item_name: string
  effective_start: string | null
  effective_end: string | null
  batch_label: string | null
}

// Stable key for the batch a row belongs to (window + label).
export const mixBatchKey = (r: Pick<DatedMapping, 'effective_start' | 'effective_end' | 'batch_label'>) =>
  `${r.effective_start ?? ''}|${r.effective_end ?? ''}|${r.batch_label ?? ''}`

// A row is "dated" if it has any window bound; otherwise it's the always-on batch.
const isDated = (r: DatedMapping) => r.effective_start != null || r.effective_end != null

/**
 * Pick the mapping rows in effect on `asOf` (a YYYY-MM-DD date string).
 *
 * Per line item: if any DATED batch covers the date, use the rows of the
 * most-recently-started covering batch (so accidental overlaps still resolve to
 * one batch deterministically). Otherwise fall back to the un-dated "always-on"
 * rows — exactly today's behaviour until batches are added. A line item whose
 * only batches are future/expired (and has no always-rows) yields nothing for
 * that date: an intentional gap means "no mix defined", not stale chemicals.
 */
export function selectMappingsForDate<T extends DatedMapping>(rows: T[], asOf: string): T[] {
  const byLineItem = new Map<string, T[]>()
  for (const r of rows) {
    const arr = byLineItem.get(r.jobber_line_item_name) ?? []
    arr.push(r)
    byLineItem.set(r.jobber_line_item_name, arr)
  }
  const out: T[] = []
  for (const group of byLineItem.values()) {
    const covering = group.filter(r =>
      isDated(r) &&
      (r.effective_start == null || r.effective_start <= asOf) &&
      (r.effective_end == null || r.effective_end >= asOf))
    if (covering.length > 0) {
      const winner = covering.reduce((best, r) =>
        (r.effective_start ?? '') > (best.effective_start ?? '') ? r : best, covering[0])
      const key = mixBatchKey(winner)
      out.push(...covering.filter(r => mixBatchKey(r) === key))
    } else {
      out.push(...group.filter(r => !isDated(r)))
    }
  }
  return out
}

// Today as YYYY-MM-DD in an IANA tz (default Central — Heroes' tz). The natural
// default "as of" for resolving a mix when no explicit date is supplied.
export function todayInTz(timeZone = 'America/Chicago'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

// Do any two DATED batches among these rows overlap? (Used by the admin UI to
// warn — overlaps make date resolution ambiguous.) The always-on batch never
// "overlaps"; it's only ever a fallback.
export function datedBatchesOverlap(rows: DatedMapping[]): boolean {
  const seen = new Map<string, { start: string; end: string }>()
  for (const r of rows) {
    if (!isDated(r)) continue
    const k = mixBatchKey(r)
    if (!seen.has(k)) seen.set(k, { start: r.effective_start ?? '-infinity', end: r.effective_end ?? 'infinity' })
  }
  const windows = [...seen.values()]
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const a = windows[i], b = windows[j]
      if (a.start <= b.end && b.start <= a.end) return true
    }
  }
  return false
}

// ── Programs & rounds (2026-07-09 redesign) ─────────────────────────────────
// The admin UI now groups line items by their `program` tag and presents each
// dated batch as a "Round". These helpers are shared by the panel and the
// Service Builder's round pre-fill.

// "Round 2" < "Round 10" (plain localeCompare puts 10 before 2).
export const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

// Draft rounds (imported from the legacy Current Rounds tab, or newly added
// without dates) need DISTINCT start dates before the real windows are set —
// the service_products unique key includes effective_start, and the same
// product usually appears in several rounds. We park them on obviously-fake
// single-day windows in year 2000; the UI refuses to activate a round while
// its start is still a placeholder, so they can never affect the Mix Sheet,
// Route Loadout, or Pesticide records.
export const PLACEHOLDER_DATE_PREFIX = '2000-'
export const isPlaceholderDate = (d: string | null | undefined): boolean =>
  !!d && d.startsWith(PLACEHOLDER_DATE_PREFIX)

// The next `count` unused placeholder dates for a line item (2000-01-01, -02, …).
export function placeholderStarts(existingStarts: Array<string | null>, count: number): string[] {
  const used = new Set(existingStarts.filter(isPlaceholderDate))
  const out: string[] = []
  const d = new Date(Date.UTC(2000, 0, 1))
  while (out.length < count) {
    const iso = d.toISOString().slice(0, 10)
    if (!used.has(iso)) { used.add(iso); out.push(iso) }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

// Derive per-program rounds from mapping rows, for seeding a new Service
// Builder version. Each batch of a program-tagged line item = one round
// (drafts included — composition is what matters for costing, not dates).
export type SeededRound = { id: string; program: string; round_label: string | null; product_ids: string[] }

export function deriveRoundsFromMappings(
  rows: Array<Pick<ServiceProduct, 'program' | 'product_id' | 'jobber_line_item_name' | 'effective_start' | 'effective_end' | 'batch_label'>>,
): SeededRound[] {
  const byKey = new Map<string, { program: string; start: string | null; label: string | null; ids: Set<string> }>()
  for (const r of rows) {
    const program = r.program?.trim()
    if (!program) continue
    // The undated always-on batch is a fallback, not a round — including it
    // would inflate the Builder's annual product cost by an extra "round".
    if (r.effective_start == null && r.effective_end == null) continue
    const key = `${program}|${r.jobber_line_item_name}|${mixBatchKey(r)}`
    let b = byKey.get(key)
    if (!b) { b = { program, start: r.effective_start, label: r.batch_label, ids: new Set() }; byKey.set(key, b) }
    if (r.product_id) b.ids.add(r.product_id)
  }
  return [...byKey.entries()]
    .filter(([, b]) => b.ids.size > 0)
    .sort(([, a], [, b]) =>
      naturalCompare(a.program, b.program) ||
      (a.start ?? '9999').localeCompare(b.start ?? '9999') ||
      naturalCompare(a.label ?? '', b.label ?? ''))
    .map(([id, b]) => ({ id, program: b.program, round_label: b.label, product_ids: [...b.ids] }))
}
