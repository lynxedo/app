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
  // Watering schedule — what the controller is set to today, and when it should
  // next be changed (seasonal adjustment). Shown to the customer.
  schedDays?: string[]          // WEEKDAYS values
  schedStarts?: string[]        // 'HH:MM' (24h, from <input type="time">); several per day is normal
  schedAdjustOn?: string        // 'YYYY-MM-DD' — when the schedule should next be adjusted
  schedAdjustChanges?: string[] // SCHEDULE_CHANGES values
  schedAdjustNote?: string
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
  // Final notes & recommendations — the tech's closing word, dictated or typed,
  // optionally polished. Shown to the customer (the internal counterpart is extraNotes).
  finalNotes?: string
  // Review state for dictated values — `${zoneIndex}:${field}` for every zone
  // field written by the dictation endpoint and not yet confirmed by the tech.
  // Persisted (not just component state) so backgrounding the phone mid-walk
  // can't turn unreviewed AI output into something that looks tech-entered.
  // INTERNAL — never part of the customer projection below.
  aiFilled?: string[]
  // The customer's Rachio controller, remembered after Import from Rachio so
  // ▶ Test run zones knows which one. INTERNAL — not in the customer projection.
  rachioDeviceId?: string
}

export function emptyIrrigationZone(): IrrigationZone {
  return { zone: '', area: '', waters: '', head: '', count: '', nozzle: '', sun: '', slope: '', valve: '', runtime: '', issues: '' }
}

/** True when every field on the zone is still blank (a placeholder row). */
export function zoneIsEmpty(z: IrrigationZone): boolean {
  return Object.values(z).every(v => !String(v ?? '').trim())
}

// ── Watering schedule ───────────────────────────────────────────────────────

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export const SCHEDULE_CHANGES = [
  'Remove days', 'Add days', 'Shorten run times', 'Lengthen run times',
  'Change start times', 'Turn off for winter', 'Turn back on',
] as const

/** Days in calendar order, whatever order they were tapped in. */
export function orderedDays(days: string[] | undefined): string[] {
  const set = new Set(days ?? [])
  return WEEKDAYS.filter(d => set.has(d))
}

/** '05:30' → '5:30 AM'. Anything that isn't HH:MM passes through as typed. */
export function fmtStartTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t || '').trim())
  if (!m) return (t || '').trim()
  const h = Number(m[1])
  if (h > 23) return t.trim()
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

/** Start times, blanks dropped, earliest first, formatted for reading. */
export function fmtStartTimes(starts: string[] | undefined): string[] {
  return (starts ?? []).map(s => (s || '').trim()).filter(Boolean).sort().map(fmtStartTime)
}

/** '2026-11-15' → 'November 15, 2026'. */
export function fmtScheduleDate(d: string | undefined): string {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return d || ''
  const dt = new Date(d + 'T00:00:00')
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
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
 * A dictated zone: the fields the tech spoke, plus how they asked for them to
 * land. No mode = describing the zone (fill blanks only). `edit` = "edit zone 3"
 * / "change zone 3" — the spoken values replace what's there. `add` = "add to
 * zone 3" — the spoken issue is added to the zone's existing issues.
 */
export type DictatedZone = Partial<IrrigationZone> & { mode?: 'edit' | 'add' }

/**
 * Coerce one model-proposed zone into a shape the form could have produced.
 * Every field goes through a validator; unknown keys are dropped entirely.
 */
export function sanitizeDictatedZone(raw: unknown): DictatedZone {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: DictatedZone = {}
  if (r.mode === 'edit' || r.mode === 'add') out.mode = r.mode
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
 * Describing a zone: a dictated value may fill a blank field, or correct a value
 * the AI itself put there and the tech hasn't confirmed yet (so "zone three
 * actually has eight heads" works). It never overwrites something the tech typed
 * or confirmed.
 *
 * The one exception is when the tech explicitly asks: "edit zone 3 …" replaces
 * the values they speak, and "add to zone 3 …" appends to that zone's issues.
 * Either way every value written is marked for review (amber), so a change the
 * microphone made is always visible.
 *
 * Rows are matched on zone number; an unmatched zone takes the first blank row
 * before appending, so dictating into a fresh form fills the placeholder rows
 * instead of leaving six empty ones stranded above the real data.
 */
export function mergeDictatedZones(
  existing: IrrigationZone[],
  dictated: DictatedZone[],
  aiFilled: string[],
): ZoneMergeResult {
  // Number placeholder-numbered rows first, so "edit zone 1" finds the card that
  // was showing "1" even though nobody typed the number in.
  const zones = numberZones(existing).map(z => ({ ...z }))
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

    const mode = patch.mode
    for (const [k, raw] of Object.entries(patch) as [keyof IrrigationZone | 'mode', string][]) {
      if (k === 'mode' || !raw) continue
      const key = `${idx}:${k}`
      const current = String(zones[idx][k] ?? '').trim()
      let v = raw
      if (mode === 'add' && k === 'issues' && current) {
        if (current.toLowerCase().includes(raw.toLowerCase())) continue
        v = cleanZoneText(`${current}; ${raw}`, 300)
      }
      const writable = !current || marks.has(key) || mode === 'edit' || mode === 'add'
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

// ── Zone order ──────────────────────────────────────────────────────────────
// Cards are kept in zone-number order. Rows with no number (an untouched
// placeholder, or a card still being filled in) go last, in their current order.

function zoneNum(z: IrrigationZone): number | null {
  const m = String(z.zone ?? '').match(/\d+/)
  return m ? Number(m[0]) : null
}

/**
 * Give a number to every row that has something in it but no zone number — the
 * number its card was showing as a placeholder (position + 1) if nobody else has
 * it, else the next free one. Without this, sorting would send a filled-in
 * "zone 1" card that was never given a real number to the bottom.
 */
export function numberZones(zones: IrrigationZone[]): IrrigationZone[] {
  const used = new Set(zones.map(zoneNum).filter((n): n is number => n != null))
  return zones.map((z, i) => {
    if (zoneNum(z) != null || zoneIsEmpty(z)) return z
    let n = used.has(i + 1) ? Math.max(0, ...used) + 1 : i + 1
    while (used.has(n)) n++
    used.add(n)
    return { ...z, zone: String(n) }
  })
}

/** Stable sort by zone number; `order[newIndex] = oldIndex`. */
export function zoneOrder(zones: IrrigationZone[]): number[] {
  return zones
    .map((z, i) => ({ i, n: zoneNum(z) }))
    .sort((a, b) => {
      if (a.n == null && b.n == null) return a.i - b.i
      if (a.n == null) return 1
      if (b.n == null) return -1
      return a.n - b.n || a.i - b.i
    })
    .map(x => x.i)
}

/** Number, then sort, the zone rows — re-keying the positional review marks to match. */
export function sortZones(zones: IrrigationZone[], aiFilled: string[]): {
  zones: IrrigationZone[]; aiFilled: string[]; order: number[]; changed: boolean
} {
  const numbered = numberZones(zones)
  const order = zoneOrder(numbered)
  const moved = order.some((oldIdx, newIdx) => oldIdx !== newIdx)
  const renumbered = numbered.some((z, i) => z !== zones[i])
  if (!moved) return { zones: numbered, aiFilled, order, changed: renumbered }
  const newIndexOf = new Map(order.map((oldIdx, newIdx) => [oldIdx, newIdx]))
  const marks = aiFilled.map(key => {
    const sep = key.indexOf(':')
    const head = key.slice(0, sep)
    if (sep < 0 || !/^\d+$/.test(head)) return key
    const ni = newIndexOf.get(Number(head))
    return ni == null ? key : `${ni}:${key.slice(sep + 1)}`
  })
  return { zones: order.map(i => numbered[i]), aiFilled: marks, order, changed: true }
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

// Oct 7 2026 (Ben): the customer sees each zone's sun exposure, run time and
// condition notes too — techs write zone issues for the customer to read.
export type CustomerZone = { zone: string; area: string; waters: string; head: string; count: string; sun: string; runtime: string; notes: string }

export type CustomerSummary = {
  source: string[]
  psi: string
  controller: { brand: string; model: string; type: string; stations: string; location: string }
  backflow: { type: string; location: string }
  mainShutoff: string
  zones: CustomerZone[]
  overallCond: string
  recommendations: string[]
  schedule: { days: string[]; starts: string[]; adjustOn: string; adjustChanges: string[]; adjustNote: string }
  finalNotes: string
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
    zones: zoneOrder(zones).map(i => zones[i]).map(z => ({
      zone: z.zone || '',
      area: z.area || '',
      waters: z.waters || '',
      head: z.head || '',
      count: z.count || '',
      sun: z.sun || '',
      runtime: z.runtime || '',
      notes: (z.issues || '').trim(),
    })).filter(z => z.zone || z.area || z.waters || z.head || z.count || z.notes),
    overallCond: d.overallCond || '',
    recommendations: Array.isArray(d.upgrades) ? d.upgrades.filter(Boolean) : [],
    schedule: {
      days: orderedDays(Array.isArray(d.schedDays) ? d.schedDays : []),
      starts: fmtStartTimes(Array.isArray(d.schedStarts) ? d.schedStarts : []),
      adjustOn: fmtScheduleDate(d.schedAdjustOn),
      adjustChanges: Array.isArray(d.schedAdjustChanges) ? d.schedAdjustChanges.filter(Boolean) : [],
      adjustNote: (d.schedAdjustNote || '').trim(),
    },
    finalNotes: (d.finalNotes || '').trim(),
  }
}
