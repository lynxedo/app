// Irrigation System Inventory — shared types + helpers.
//
// The form payload is stored as JSONB (`irrigation_inspections.data`) so the
// field set can evolve without a migration. `IrrigationData` documents the shape
// the UI reads/writes; unknown keys are preserved on round-trip.
//
// This module is imported by client components for its types, so it must stay
// free of Node built-ins. The share-token generator (needs node:crypto) lives in
// the server route that mints links.

export type IrrigationZone = {
  zone: string      // station number/label
  area: string      // area served
  waters: string    // Turf / Shrub beds / …
  head: string      // Spray / Rotor / MP Rotator / Drip / …
  count: string     // # of heads
  nozzle: string    // nozzle / brand
  sun: string       // Full sun / Part sun / Shade
  slope: string     // Flat / Slight / Steep
  valve: string     // valve box location for this zone
  runtime: string   // minutes
  issues: string    // condition / issues
}

export type IrrigationData = {
  // System overview
  installYear?: string
  installer?: string
  maintPlan?: string        // 'yes' | 'no'
  // Water source & supply
  source?: string[]
  psi?: string
  gpm?: string
  meterSize?: string
  prv?: string
  poc?: string
  pump?: string
  // Controller
  ctrlLoc?: string
  ctrlBrand?: string
  ctrlModel?: string
  stationsTotal?: string
  stationsUsed?: string
  ctrlType?: string
  ctrlWifi?: string
  ctrlBatt?: string
  ctrlMv?: string
  accessories?: string[]
  programs?: string
  // Backflow
  bfType?: string
  bfLoc?: string
  bfGrade?: string
  bfInsul?: string
  bfCond?: string
  // Shutoffs & isolation
  isoMain?: string
  meterLoc?: string
  isoSecondary?: string
  // Valve boxes
  vbCount?: string
  vbLocs?: string
  vbNotes?: string
  // Zones
  zones?: IrrigationZone[]
  // Overall condition & recommendations
  overallCond?: string
  repairs?: string          // INTERNAL — never shown to the customer
  upgrades?: string[]       // shown to the customer as "recommendations"
  photosNote?: string       // INTERNAL
  estValue?: string         // INTERNAL — dollar figure
  extraNotes?: string       // INTERNAL
  // Review state for dictated values — `${zoneIndex}:${field}` for every zone
  // field written by the dictation endpoint and not yet confirmed by the tech.
  // Persisted (not just component state) so backgrounding the phone mid-walk
  // can't turn unreviewed AI output into something that looks tech-entered.
  // INTERNAL — never part of the customer projection below.
  aiFilled?: string[]
}

export function emptyIrrigationZone(): IrrigationZone {
  return { zone: '', area: '', waters: '', head: '', count: '', nozzle: '', sun: '', slope: '', valve: '', runtime: '', issues: '' }
}

/** True when every field on the zone is still blank (a placeholder row). */
export function zoneIsEmpty(z: IrrigationZone): boolean {
  return Object.values(z).every(v => !String(v ?? '').trim())
}

// ── Zone field vocabularies ─────────────────────────────────────────────────
// The single source of truth for the constrained zone fields. The form renders
// its dropdowns from these AND the dictation endpoint validates against them, so
// a spoken value can only ever become one of the options a tech could have
// tapped. Anything that doesn't map is dropped, never invented.

export const ZONE_WATERS = ['Turf', 'Shrub beds', 'Flower beds', 'Trees', 'Garden', 'Mixed'] as const
export const ZONE_HEADS = ['Spray', 'Rotor', 'MP Rotator', 'Drip', 'Bubbler', 'Micro', 'Mixed'] as const
export const ZONE_SUN = ['Full sun', 'Part sun', 'Shade'] as const
export const ZONE_SLOPE = ['Flat', 'Slight', 'Steep'] as const

/** Spoken phrasings a tech actually uses, mapped to the option they mean. */
const ZONE_ALIASES: Record<string, Record<string, string>> = {
  waters: {
    'grass': 'Turf', 'lawn': 'Turf', 'sod': 'Turf', 'turf grass': 'Turf',
    'shrub': 'Shrub beds', 'shrubs': 'Shrub beds', 'shrub bed': 'Shrub beds',
    'bed': 'Shrub beds', 'beds': 'Shrub beds', 'landscape beds': 'Shrub beds',
    'flowers': 'Flower beds', 'flower bed': 'Flower beds', 'annuals': 'Flower beds',
    'tree': 'Trees', 'garden bed': 'Garden', 'vegetable garden': 'Garden',
  },
  head: {
    'sprays': 'Spray', 'spray head': 'Spray', 'spray heads': 'Spray', 'pop up': 'Spray', 'pop-up': 'Spray', 'popup': 'Spray',
    'rotors': 'Rotor', 'rotor head': 'Rotor', 'rotor heads': 'Rotor', 'gear drive': 'Rotor',
    'mp': 'MP Rotator', 'mp rotators': 'MP Rotator', 'mp rotor': 'MP Rotator', 'rotators': 'MP Rotator', 'rotator': 'MP Rotator',
    'drip line': 'Drip', 'dripline': 'Drip', 'drip tube': 'Drip', 'drip tubing': 'Drip', 'inline drip': 'Drip',
    'bubblers': 'Bubbler', 'micro spray': 'Micro', 'microspray': 'Micro',
  },
  sun: {
    'sun': 'Full sun', 'full': 'Full sun', 'full sunlight': 'Full sun',
    'partial sun': 'Part sun', 'part shade': 'Part sun', 'partial shade': 'Part sun', 'part': 'Part sun',
    'shaded': 'Shade', 'full shade': 'Shade',
  },
  slope: {
    'level': 'Flat', 'no slope': 'Flat',
    'slight slope': 'Slight', 'gentle': 'Slight', 'gentle slope': 'Slight', 'mild': 'Slight',
    'steep slope': 'Steep', 'hill': 'Steep', 'hilly': 'Steep', 'sharp': 'Steep',
  },
}

const ZONE_OPTIONS: Record<string, readonly string[]> = {
  waters: ZONE_WATERS, head: ZONE_HEADS, sun: ZONE_SUN, slope: ZONE_SLOPE,
}

/**
 * Map a spoken/typed value onto an allowed option for a constrained zone field.
 * Returns '' when it cannot be matched confidently — a blank the tech can fill
 * is always better than a plausible wrong value they might not re-read.
 */
export function matchZoneOption(field: string, raw: unknown): string {
  const options = ZONE_OPTIONS[field]
  if (!options) return ''
  const v = String(raw ?? '').trim().toLowerCase().replace(/[.,]+$/, '')
  if (!v) return ''
  const exact = options.find(o => o.toLowerCase() === v)
  if (exact) return exact
  const alias = ZONE_ALIASES[field]?.[v]
  if (alias) return alias
  // Try the singular ("rotors" → "rotor") against both options and aliases.
  if (v.endsWith('s')) {
    const singular = v.slice(0, -1)
    const exactS = options.find(o => o.toLowerCase() === singular)
    if (exactS) return exactS
    const aliasS = ZONE_ALIASES[field]?.[singular]
    if (aliasS) return aliasS
  }
  return ''
}

/**
 * The FIRST run of digits, capped — for zone number / head count / run time.
 *
 * Deliberately not "strip every non-digit": that turns "3 to 5 minutes" into
 * 35 and "zone 3, 20 minutes" into 320 — numbers that look entirely reasonable
 * in a form field and are silently wrong. Taking the first run yields 3, which
 * is either right or obviously worth a second look.
 */
export function cleanZoneNumber(raw: unknown, maxLen = 4): string {
  const m = String(raw ?? '').match(/\d+/)
  return m ? m[0].slice(0, maxLen) : ''
}

/** Trimmed free text with a hard length cap. */
export function cleanZoneText(raw: unknown, maxLen = 200): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLen)
}

/**
 * Coerce one model-proposed zone into a shape the form could have produced.
 * Every field goes through a validator; unknown keys are dropped entirely.
 */
export function sanitizeDictatedZone(raw: unknown): Partial<IrrigationZone> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Partial<IrrigationZone> = {}
  const put = (k: keyof IrrigationZone, v: string) => { if (v) out[k] = v }
  put('zone', cleanZoneNumber(r.zone))
  put('area', cleanZoneText(r.area, 120))
  put('waters', matchZoneOption('waters', r.waters))
  put('head', matchZoneOption('head', r.head))
  put('count', cleanZoneNumber(r.count, 3))
  put('nozzle', cleanZoneText(r.nozzle, 80))
  put('sun', matchZoneOption('sun', r.sun))
  put('slope', matchZoneOption('slope', r.slope))
  put('valve', cleanZoneText(r.valve, 120))
  put('runtime', cleanZoneNumber(r.runtime, 3))
  put('issues', cleanZoneText(r.issues, 300))
  return out
}

// ── Merging dictated zones into the draft ───────────────────────────────────

export type ZoneMergeResult = {
  zones: IrrigationZone[]
  /** `${zoneIndex}:${field}` keys still awaiting the tech's confirmation. */
  aiFilled: string[]
  /** How many individual fields this dictation wrote. */
  fieldsWritten: number
  /** Indices of the zone rows this dictation created or changed. */
  touched: number[]
}

/**
 * Fold dictated zones into the existing rows.
 *
 * A dictated value may fill a blank field, or correct a value the AI itself put
 * there and the tech hasn't confirmed yet (so "zone three actually has eight
 * heads" works). It may NEVER overwrite something the tech typed or confirmed —
 * their hands on the form always win over the microphone.
 *
 * Rows are matched on zone number; an unmatched zone takes the first blank row
 * before appending, so dictating into a fresh form fills the placeholder rows
 * instead of leaving six empty ones stranded above the real data.
 */
export function mergeDictatedZones(
  existing: IrrigationZone[],
  dictated: Partial<IrrigationZone>[],
  aiFilled: string[],
): ZoneMergeResult {
  const zones = existing.map(z => ({ ...z }))
  const marks = new Set(aiFilled)
  const touched = new Set<number>()
  let fieldsWritten = 0

  for (const patch of dictated) {
    const num = (patch.zone || '').trim()

    let idx = num
      ? zones.findIndex(z => (z.zone || '').trim() === num)
      : -1
    if (idx < 0) idx = zones.findIndex(zoneIsEmpty)
    if (idx < 0) { zones.push(emptyIrrigationZone()); idx = zones.length - 1 }

    for (const [k, v] of Object.entries(patch) as [keyof IrrigationZone, string][]) {
      if (!v) continue
      const key = `${idx}:${k}`
      const current = String(zones[idx][k] ?? '').trim()
      const writable = !current || marks.has(key)
      if (!writable) continue
      if (current === v) { continue }
      zones[idx][k] = v
      marks.add(key)
      touched.add(idx)
      fieldsWritten++
    }
  }

  return { zones, aiFilled: Array.from(marks), fieldsWritten, touched: Array.from(touched) }
}

/** Drop review marks for a zone row (the tech confirmed it). */
export function confirmZoneMarks(aiFilled: string[], zoneIndex: number): string[] {
  return aiFilled.filter(k => !k.startsWith(`${zoneIndex}:`))
}

/**
 * Re-key review marks after a zone row is removed — zone marks are positional,
 * so a deletion above them would otherwise leave the amber highlight sitting on
 * some other zone's fields.
 *
 * Top-level marks (`f:ctrlBrand`, written by the photo reader) are not
 * positional and pass through untouched. Dropping them here would silently
 * un-flag photo-read values the moment an unrelated zone row was deleted —
 * exactly the "looks confirmed but nobody checked it" state the marks exist to
 * prevent.
 */
export function reindexZoneMarks(aiFilled: string[], removedIndex: number): string[] {
  const out: string[] = []
  for (const key of aiFilled) {
    const sep = key.indexOf(':')
    if (sep < 0) continue
    const head = key.slice(0, sep)
    if (!/^\d+$/.test(head)) { out.push(key); continue }
    const idx = Number(head)
    if (idx === removedIndex) continue
    out.push(idx > removedIndex ? `${idx - 1}:${key.slice(sep + 1)}` : key)
  }
  return out
}

/** Customer summary links expire this many days after they're (re)generated. */
export const SHARE_TTL_DAYS = 60

export function shareExpiryFromNow(nowIso: string): string {
  const d = new Date(nowIso)
  d.setDate(d.getDate() + SHARE_TTL_DAYS)
  return d.toISOString()
}

// ── Customer-safe projection ────────────────────────────────────────────────
// The internal inventory holds things we must NEVER text a customer — the gate
// code (lives on the property, not here, but guard anyway), the estimated
// follow-up dollar value, internal repair shorthand, and private notes. This is
// the single allowlist of what the public summary page may render. Anything not
// copied here cannot reach the customer, even if the form later grows new fields.

export type CustomerZone = { zone: string; area: string; waters: string; head: string; count: string }

export type CustomerSummary = {
  source: string[]
  psi: string
  controller: { brand: string; model: string; type: string; stations: string; location: string }
  backflow: { type: string; location: string }
  mainShutoff: string
  zones: CustomerZone[]
  overallCond: string
  recommendations: string[]
}

export function toCustomerSummary(raw: unknown): CustomerSummary {
  const d = (raw && typeof raw === 'object' ? raw : {}) as IrrigationData
  const zones = Array.isArray(d.zones) ? d.zones : []
  return {
    source: Array.isArray(d.source) ? d.source.filter(Boolean) : [],
    psi: d.psi || '',
    controller: {
      brand: d.ctrlBrand || '',
      model: d.ctrlModel || '',
      type: d.ctrlType || '',
      stations: d.stationsTotal || '',
      location: d.ctrlLoc || '',
    },
    backflow: { type: d.bfType || '', location: d.bfLoc || '' },
    mainShutoff: d.isoMain || '',
    zones: zones.map(z => ({
      zone: z.zone || '',
      area: z.area || '',
      waters: z.waters || '',
      head: z.head || '',
      count: z.count || '',
    })).filter(z => z.zone || z.area || z.waters || z.head || z.count),
    overallCond: d.overallCond || '',
    recommendations: Array.isArray(d.upgrades) ? d.upgrades.filter(Boolean) : [],
  }
}
