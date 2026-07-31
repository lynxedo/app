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
}

export function emptyIrrigationZone(): IrrigationZone {
  return { zone: '', area: '', waters: '', head: '', count: '', nozzle: '', sun: '', slope: '', valve: '', runtime: '', issues: '' }
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
