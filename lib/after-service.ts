// Work Orders Phase 3 — the after-service report for lawn-treatment stops
// (WF weed & fert, MO mosquito). Pure module: imported by the client form, the
// customer-file card and the server routes, so no Node built-ins here
// (server-only helpers live in lib/after-service-server.ts).
//
// Built like the irrigation inspection (lib/irrigation.ts): one `data` jsonb
// holding the whole form, customer-facing and INTERNAL fields side by side. The
// customer page renders only an allowlist; customers never see product names —
// only a description of what the treatment does (Ben, Oct 5 2026).

/** One product on the report — INTERNAL. Pre-filled from the pesticide mapping; the tech confirms it. */
export type AsrProduct = {
  /** Stable key for the row: the product id, or `added:<n>` for one the tech typed in. */
  key: string
  productId: string | null
  name: string
  epa: string | null
  /** The rate the mapping says this service uses (e.g. "0.1 oz/1,000 sq ft"). */
  mappedRate: string | null
  /** The work-order line item that brought this product in. */
  forService: string | null
  /** The tech's answer: was it actually put down? '' until they say. */
  applied: 'yes' | 'no' | ''
  /** What was actually used, in the tech's words ("2.5 gal", "same as mapped"). */
  amount: string
  note: string
  /** Not in the mapping — the tech added it. */
  added?: boolean
}

/**
 * What one treatment does, in the customer's words — copied in from the
 * office's Report text (after_service_templates) when the report is saved, so a
 * later edit of that text never changes a report already sent.
 */
export type AsrTreatment = {
  /** The line item it came from ("WF - Lawn Health Basic"). */
  service: string
  /** What the customer reads as the heading ("Lawn Health Basic"). */
  display: string
  /** The Service Mapping round in effect on the visit date ("Round 3"), when known. */
  round: string | null
  description: string
  care: string
}

export type AfterServiceData = {
  /** What was done — the stop's accepted work-order line items (refreshed from the stop). */
  services?: { name: string; qty: number }[]
  /** What each treatment does + care instructions (customer-facing, from the office's text). */
  treatments?: AsrTreatment[]
  /** What the tech saw (keys of OBSERVATIONS). Customer-facing. */
  observations?: string[]
  mowingHeight?: '' | 'ok' | 'short' | 'tall'
  /** Customer-facing note on what was seen. */
  observationNotes?: string
  /** Recommendation chips (RECOMMENDATIONS). Customer-facing. */
  recommendations?: string[]
  /** Customer-facing recommendation text. */
  recommendationNotes?: string
  // ── INTERNAL — never on the customer page ─────────────────────────────────
  products?: AsrProduct[]
  internalNotes?: string
  /** Weather on the stop when the report was saved (from the stop's NWS snapshot). */
  weather?: { temperature_f?: number | null; conditions?: string | null; wind_mph?: number | null; humidity_pct?: number | null } | null
}

export const OBSERVATIONS: { key: string; label: string }[] = [
  { key: 'weeds', label: 'Weeds present' },
  { key: 'disease', label: 'Disease / fungus' },
  { key: 'insects', label: 'Insect activity' },
  { key: 'bare', label: 'Bare or thin spots' },
  { key: 'irrigation', label: 'Irrigation problem' },
]

export const MOWING: { v: 'ok' | 'short' | 'tall'; label: string }[] = [
  { v: 'ok', label: 'Good' },
  { v: 'short', label: 'Too short' },
  { v: 'tall', label: 'Too tall' },
]

export const RECOMMENDATIONS = [
  'Adjust watering',
  'Raise mowing height',
  'Aeration',
  'Overseeding',
  'Grub control',
  'Fungicide treatment',
  'Irrigation check',
]

export function observationLabel(key: string): string {
  return OBSERVATIONS.find(o => o.key === key)?.label ?? key
}

/** Products the tech still has to answer (Applied / Not applied) before the report can be saved. */
export function unansweredProducts(d: AfterServiceData): AsrProduct[] {
  return (d.products ?? []).filter(p => p.name.trim() && p.applied === '')
}

/** A product the tech typed in (not from the mapping). */
export function newAddedProduct(existing: AsrProduct[]): AsrProduct {
  const n = existing.filter(p => p.added).length + 1
  return {
    key: `added:${Date.now().toString(36)}${n}`,
    productId: null, name: '', epa: null, mappedRate: null, forService: null,
    applied: 'yes', amount: '', note: '', added: true,
  }
}

/**
 * Merge a fresh list of mapped products into the report's list. A product the
 * tech already answered keeps the tech's answer; a newly mapped one is added
 * unanswered; a mapped one that no longer applies (its line item was removed)
 * is dropped only if the tech never touched it. Products the tech added stay.
 */
export function mergeMappedProducts(current: AsrProduct[], mapped: AsrProduct[]): AsrProduct[] {
  const byKey = new Map(current.map(p => [p.key, p]))
  const mappedKeys = new Set(mapped.map(p => p.key))
  const out: AsrProduct[] = []
  for (const m of mapped) {
    const cur = byKey.get(m.key)
    out.push(cur ? { ...m, applied: cur.applied, amount: cur.amount, note: cur.note } : m)
  }
  for (const p of current) {
    if (mappedKeys.has(p.key)) continue
    const touched = p.added || p.applied !== '' || p.amount.trim() || p.note.trim()
    if (touched) out.push(p)
  }
  return out
}

/** "WF - Lawn Health Basic" → "Lawn Health Basic": the Jobber department prefix means nothing to a customer. */
export function customerServiceName(name: string): string {
  return name.replace(/^\s*[A-Z]{2,3}\s*-\s*(OT\s*-\s*)?/i, '').replace(/\s+/g, ' ').trim()
}

/** Line items a customer shouldn't see listed as "work done" (pricing adjustments). */
export function isAdjustmentItem(name: string): boolean {
  return /\b(discount|credit|coupon|promo|refund)\b/i.test(name)
}

/**
 * The customer-safe projection of a report — the ONLY thing the public page
 * renders. Products, amounts, EPA numbers and internal notes never leave the
 * server (Ben, Oct 5 2026: no product names to customers).
 */
export function toCustomerReport(d: AfterServiceData) {
  const treated = new Set((d.treatments ?? []).map(t => t.service))
  return {
    treatments: (d.treatments ?? [])
      .filter(t => t.description.trim() || t.care.trim())
      .map(t => ({ name: t.display, round: t.round, description: t.description.trim(), care: t.care.trim() })),
    otherServices: (d.services ?? [])
      .filter(s => s.name && !treated.has(s.name) && !isAdjustmentItem(s.name) && s.qty > 0)
      .map(s => customerServiceName(s.name)),
    observations: (d.observations ?? []).map(observationLabel),
    mowingHeight: d.mowingHeight === 'short' ? 'A little short — raising the mower blade will help'
      : d.mowingHeight === 'tall' ? 'A little tall — regular mowing will help'
      : d.mowingHeight === 'ok' ? 'Looks good' : '',
    observationNotes: (d.observationNotes ?? '').trim(),
    recommendations: d.recommendations ?? [],
    recommendationNotes: (d.recommendationNotes ?? '').trim(),
    weather: d.weather && (typeof d.weather.temperature_f === 'number' || d.weather.conditions)
      ? [typeof d.weather.temperature_f === 'number' ? `${d.weather.temperature_f}°F` : null, d.weather.conditions].filter(Boolean).join(', ')
      : '',
  }
}

export const REPORT_SHARE_TTL_DAYS = 60
