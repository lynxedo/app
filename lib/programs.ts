// lib/programs.ts
// Canonical program registry — stable key, display name, and short abbreviation
// (LHB / LHP / LHC / RRR …) used for the compact column tags + the program picker
// on the Technician Mix Sheet. Mirrors the published program_price_charts.
//
// Pure + dependency-free (client + server). A line item that matches no known
// program falls back to its own (prefix-stripped) name, so nothing is silently
// dropped from the sheet.

export type ProgramDef = { key: string; name: string; abbr: string; sort: number }

export const PROGRAMS: ProgramDef[] = [
  { key: 'lawn_health_basic',    name: 'Lawn Health Basic',    abbr: 'LHB',  sort: 10 },
  { key: 'lawn_health_plus',     name: 'Lawn Health Plus',     abbr: 'LHP',  sort: 20 },
  { key: 'lawn_health_complete', name: 'Lawn Health Complete', abbr: 'LHC',  sort: 30 },
  { key: 'root_rot_recovery',    name: 'Root Rot Recovery',    abbr: 'RRR',  sort: 40 },
  { key: 'organic_fertilizer',   name: 'Organic Fertilizer',   abbr: 'OF',   sort: 50 },
  { key: 'mosquito_misting',     name: 'Mosquito (Misting)',   abbr: 'MOS',  sort: 60 },
  { key: 'aeration',             name: 'Aeration',             abbr: 'AER',  sort: 110 },
  { key: 'fire_ant_control',     name: 'Fire Ant Control',     abbr: 'FA',   sort: 120 },
  { key: 'lawn_stimulator',      name: 'Lawn Stimulator',      abbr: 'STIM', sort: 130 },
  { key: 'soil_surge',           name: 'Soil Surge',           abbr: 'SS',   sort: 140 },
  { key: 'ot_fungicide',         name: 'OT Fungicide',         abbr: 'FUNG', sort: 150 },
  { key: 'ot_insect',            name: 'OT Insect',            abbr: 'INS',  sort: 160 },
  { key: 'grub_curative',        name: 'Grub Curative',        abbr: 'GRUB', sort: 170 },
  { key: 'ot_lawn_treatment',    name: 'OT Lawn Treatment',    abbr: 'OTL',  sort: 180 },
]

const byName = new Map(PROGRAMS.map(p => [p.name.toLowerCase(), p]))
const byKey = new Map(PROGRAMS.map(p => [p.key, p]))

export function programByKey(key: string | null | undefined): ProgramDef | null {
  return key ? byKey.get(key) ?? null : null
}

// Resolve a free-text program label (as stored on a mapping) to its definition.
export function findProgram(label: string | null | undefined): ProgramDef | null {
  if (!label) return null
  const l = label.trim().toLowerCase()
  return byName.get(l) ?? byKey.get(l) ?? null
}

// Which program a Jobber line item belongs to — longest program-name substring
// wins ("…Lawn Health Complete" beats "…Lawn Health"). Returns null if none.
export function programForLineItem(lineItem: string | null | undefined): ProgramDef | null {
  if (!lineItem) return null
  const l = lineItem.toLowerCase()
  let best: ProgramDef | null = null
  for (const p of PROGRAMS) {
    if (l.includes(p.name.toLowerCase()) && (!best || p.name.length > best.name.length)) best = p
  }
  return best
}

// Strip the common Jobber department prefix ("WF - ", "IR - " …) for a readable
// fallback tag when a line item maps to no known program.
export function cleanLineItemLabel(lineItem: string): string {
  return lineItem.replace(/^[A-Z]{1,3}\s*-\s*/, '').trim() || lineItem.trim()
}
