// Pin color system for the Advanced Route Planner (Session 73.3).
//
// A stop's pin is colored by the line items on its visit:
//   • a BASE program sets the pin's center fill color (one per stop — first match wins)
//   • AUX programs form a halo ring around the pin (one arc per matching aux program)
//
// Up to 5 base + 5 aux programs can be defined in Admin → Routing. The halo only
// renders the first MAX_HALO_ARCS (3) matching aux programs, in defined order —
// everything beyond that is still defined/colored, just not drawn on the ring.
//
// Settings are company-scoped, stored on company_routing_settings.pin_settings (jsonb).

export type MatchType = 'line_item' | 'keyword'

export interface PinProgram {
  id: string
  label: string       // display name (defaults to the match text)
  match: string       // exact line item name (line_item) or a substring (keyword)
  matchType: MatchType
  color: string       // hex with leading # — e.g. "#7c3aed"
}

export interface PinSettings {
  base_programs: PinProgram[]
  aux_programs: PinProgram[]
}

export const EMPTY_PIN_SETTINGS: PinSettings = { base_programs: [], aux_programs: [] }

export const MAX_BASE_PROGRAMS = 5
export const MAX_AUX_PROGRAMS = 5
export const MAX_HALO_ARCS = 3

// Fallback center fill when no base program matches a stop (slate-500).
export const DEFAULT_PIN_COLOR = '#64748b'

// Starter palette for the color pickers — distinct, map-legible hues.
export const PIN_COLOR_PALETTE = [
  '#7c3aed', // violet
  '#0ea5e9', // sky
  '#16a34a', // green
  '#f59e0b', // amber
  '#dc2626', // red
  '#db2777', // pink
  '#0d9488', // teal
  '#9333ea', // purple
  '#2563eb', // blue
  '#ca8a04', // gold
]

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function norm(s: string): string {
  return s.trim().toLowerCase()
}

/** Does a program match any of a visit's line item names? */
export function programMatches(p: PinProgram, lineItemNames: string[]): boolean {
  const m = norm(p.match)
  if (!m) return false
  if (p.matchType === 'keyword') {
    return lineItemNames.some(n => norm(n).includes(m))
  }
  // line_item: exact (case-insensitive) name match
  return lineItemNames.some(n => norm(n) === m)
}

export interface ResolvedPinColors {
  baseColor: string | null   // null → caller should use DEFAULT_PIN_COLOR
  auxColors: string[]        // every matching aux color, in defined order (caller caps to MAX_HALO_ARCS)
}

/** Resolve a stop's base fill + aux halo colors from its line items. */
export function resolvePinColors(
  lineItemNames: string[] | null | undefined,
  settings: PinSettings | null | undefined,
): ResolvedPinColors {
  const s = settings ?? EMPTY_PIN_SETTINGS
  const names = lineItemNames ?? []
  let baseColor: string | null = null
  for (const b of s.base_programs ?? []) {
    if (programMatches(b, names)) { baseColor = b.color; break } // first match wins
  }
  const auxColors: string[] = []
  for (const a of s.aux_programs ?? []) {
    if (programMatches(a, names)) auxColors.push(a.color)
  }
  return { baseColor, auxColors }
}

function cleanProgram(raw: unknown, idx: number): PinProgram | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const match = typeof r.match === 'string' ? r.match.trim().slice(0, 200) : ''
  if (!match) return null
  const label = (typeof r.label === 'string' ? r.label.trim().slice(0, 120) : '') || match
  const matchType: MatchType = r.matchType === 'keyword' ? 'keyword' : 'line_item'
  const color = typeof r.color === 'string' && HEX_RE.test(r.color) ? r.color.toLowerCase() : DEFAULT_PIN_COLOR
  const id = typeof r.id === 'string' && r.id ? r.id : `p${idx}`
  return { id, label, match, matchType, color }
}

/** Defensively coerce arbitrary input into a valid PinSettings. */
export function sanitizePinSettings(raw: unknown): PinSettings {
  const r = (raw ?? {}) as Record<string, unknown>
  const base = Array.isArray(r.base_programs) ? r.base_programs : []
  const aux = Array.isArray(r.aux_programs) ? r.aux_programs : []
  return {
    base_programs: base.map((p, i) => cleanProgram(p, i)).filter((p): p is PinProgram => !!p).slice(0, MAX_BASE_PROGRAMS),
    aux_programs: aux.map((p, i) => cleanProgram(p, i)).filter((p): p is PinProgram => !!p).slice(0, MAX_AUX_PROGRAMS),
  }
}
