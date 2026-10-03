// Work Orders Phase 2 (Part 2) — "Suggested from inspection".
//
// When an irrigation inspection tied to a stop is final, the company's rules
// (inspection_suggestion_rules, kept by the office on the Work Orders office
// page) turn what the tech recorded into PROPOSED line items on that stop —
// e.g. zone 3 "2 broken heads" on a Spray zone → IR - Spray Head- 4 inch × 2.
// The tech taps Add or ✕ on each. Nothing proposed reaches Jobber until it is
// accepted (then it goes with the rest at Complete). Prices are read live from
// the Jobber catalog (PRD rule 5). A rule already suggested on the stop — even
// one the tech turned down — is not suggested again.

import { createAdminClient } from '@/lib/supabase/admin'
import { jobberGraphQLPatient, companyJobberUserId } from '@/lib/jobber'
import { loadStopLineItems, type LineItemStop } from '@/lib/work-order-line-items'
import type { IrrigationData, IrrigationZone } from '@/lib/irrigation'

type Admin = ReturnType<typeof createAdminClient>

export type SuggestionRule = {
  id: string
  trigger_kind: 'zone_issue' | 'field'
  trigger_text: string | null
  head_filter: string | null
  trigger_field: string | null
  trigger_value: string | null
  jobber_product_id: string
  product_name: string
  quantity_mode: 'number_in_text' | 'per_zone' | 'fixed'
  fixed_quantity: number
  is_active: boolean
  sort_order: number
}

/** Inspection fields a `field` rule can test, with the form's own choices. */
export const RULE_FIELDS: Array<{ key: keyof IrrigationData; label: string; options: Array<{ v: string; label: string }> }> = [
  { key: 'bfCond', label: 'Backflow condition', options: [{ v: 'good', label: 'Good' }, { v: 'fair', label: 'Fair' }, { v: 'poor', label: 'Poor' }, { v: 'fail', label: 'Leaking' }] },
  { key: 'ctrlBatt', label: 'Controller battery backup', options: [{ v: 'Yes — OK', label: 'Yes — OK' }, { v: 'Yes — dead', label: 'Yes — dead' }, { v: 'None', label: 'None' }] },
  { key: 'prv', label: 'Pressure regulator (PRV)', options: [{ v: 'Yes — present', label: 'Yes — present' }, { v: 'No', label: 'No' }, { v: 'Needed', label: 'Needed' }] },
  { key: 'bfInsul', label: 'Backflow insulated / protected', options: [{ v: 'Yes', label: 'Yes' }, { v: 'No', label: 'No' }] },
  { key: 'ctrlWifi', label: 'Controller Wi-Fi connected', options: [{ v: 'Yes', label: 'Yes' }, { v: 'No', label: 'No' }, { v: 'N/A', label: 'N/A' }] },
  { key: 'overallCond', label: 'Overall system condition', options: [{ v: 'good', label: 'Good' }, { v: 'fair', label: 'Fair' }, { v: 'poor', label: 'Poor' }] },
]

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1 }

/** Keywords of a rule ("broken, cracked" → ['broken', 'cracked']). */
function keywords(rule: Pick<SuggestionRule, 'trigger_text'>): string[] {
  return (rule.trigger_text ?? '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
}

/**
 * The number written just before the keyword: "2 broken heads", "two broken",
 * "3 heads broken" (number within three words before). 1 when none is written.
 */
export function numberBefore(text: string, keyword: string): number {
  const lower = text.toLowerCase()
  const at = lower.indexOf(keyword)
  if (at < 0) return 0
  const before = lower.slice(0, at).trim().split(/\s+/).slice(-3).reverse()
  for (const w of before) {
    const clean = w.replace(/[^a-z0-9.]/g, '')
    if (/^\d+$/.test(clean)) return Math.min(parseInt(clean, 10), 500)
    if (WORD_NUMBERS[clean] && clean !== 'a' && clean !== 'an') return WORD_NUMBERS[clean]
  }
  return 1
}

type Match = { quantity: number; note: string }

/** What one rule finds in an inspection (null = no match). Exported for the rule preview. */
export function evaluateRule(rule: SuggestionRule, data: IrrigationData): Match | null {
  if (rule.trigger_kind === 'field') {
    if (!rule.trigger_field || rule.trigger_value == null) return null
    const v = (data as Record<string, unknown>)[rule.trigger_field]
    if (typeof v !== 'string' || v !== rule.trigger_value) return null
    const f = RULE_FIELDS.find(x => x.key === rule.trigger_field)
    const label = f?.options.find(o => o.v === v)?.label ?? v
    return { quantity: rule.quantity_mode === 'fixed' ? Number(rule.fixed_quantity) || 1 : 1, note: `${f?.label ?? rule.trigger_field}: ${label}` }
  }

  const keys = keywords(rule)
  if (keys.length === 0) return null
  const head = (rule.head_filter ?? '').trim().toLowerCase()
  const zones: IrrigationZone[] = Array.isArray(data.zones) ? data.zones : []
  let quantity = 0
  const notes: string[] = []
  zones.forEach((z, i) => {
    const issues = (z?.issues ?? '').trim()
    if (!issues) return
    if (head && !(z.head ?? '').toLowerCase().includes(head)) return
    const key = keys.find(k => issues.toLowerCase().includes(k))
    if (!key) return
    const n = rule.quantity_mode === 'number_in_text' ? numberBefore(issues, key) : 1
    quantity += n
    notes.push(`Zone ${z.zone?.trim() || i + 1}: ${issues.length > 60 ? `${issues.slice(0, 57)}…` : issues}`)
  })
  if (quantity === 0) return null
  if (rule.quantity_mode === 'fixed') quantity = Number(rule.fixed_quantity) || 1
  return { quantity, note: notes.join(' · ') }
}

type CatalogEntry = { id: string; name: string; description: string | null; defaultUnitCost: number | null; taxable: boolean | null }

const CATALOG_QUERY = `
  query SuggestionCatalog($after: String) {
    productOrServices(first: 100, after: $after) {
      nodes { id name description defaultUnitCost taxable }
      pageInfo { hasNextPage endCursor }
    }
  }
`

async function liveCatalog(companyId: string, actorUserId: string): Promise<Map<string, CatalogEntry>> {
  const jobberUserId = await companyJobberUserId(companyId, actorUserId)
  if (!jobberUserId) throw new Error('No connected Jobber account for this company')
  const out = new Map<string, CatalogEntry>()
  let after: string | null = null
  for (let page = 0; page < 10; page++) {
    const res: { data?: { productOrServices: { nodes: CatalogEntry[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } =
      await jobberGraphQLPatient(jobberUserId, CATALOG_QUERY, { after })
    const conn = res.data?.productOrServices
    if (!conn) break
    for (const p of conn.nodes) out.set(p.id, p)
    if (!conn.pageInfo.hasNextPage) break
    after = conn.pageInfo.endCursor
  }
  return out
}

export type SuggestResult = {
  added: number
  reason: 'ok' | 'no_inspection' | 'no_rules' | 'no_matches' | 'already_suggested' | 'locked'
}

/**
 * Run the rules against the stop's final inspection and add PROPOSED items.
 * Safe to call repeatedly (auto at finalize + the stop's button).
 */
export async function suggestForStop(admin: Admin, companyId: string, stopId: string, actorUserId: string): Promise<SuggestResult> {
  const { data: stop } = await admin
    .from('daily_log_stops').select('id, status, jobber_visit_id, jobber_job_id, line_items')
    .eq('id', stopId).maybeSingle<LineItemStop>()
  if (!stop) return { added: 0, reason: 'no_inspection' }
  if (stop.status === 'complete' || stop.status === 'skipped') return { added: 0, reason: 'locked' }

  // The newest FINAL inspection done on this stop (or this Jobber visit).
  let q = admin.from('irrigation_inspections').select('id, data, finalized_at')
    .eq('company_id', companyId).eq('status', 'final')
  q = stop.jobber_visit_id
    ? q.or(`stop_id.eq.${stop.id},jobber_visit_id.eq."${stop.jobber_visit_id}"`)
    : q.eq('stop_id', stop.id)
  const { data: insp } = await q.order('finalized_at', { ascending: false }).limit(1).maybeSingle<{ id: string; data: IrrigationData }>()
  if (!insp) return { added: 0, reason: 'no_inspection' }

  const { data: rulesRaw } = await admin
    .from('inspection_suggestion_rules').select('*')
    .eq('company_id', companyId).eq('is_active', true).is('deleted_at', null)
    .order('sort_order', { ascending: true }).order('created_at', { ascending: true })
  const rules = (rulesRaw ?? []) as SuggestionRule[]
  if (rules.length === 0) return { added: 0, reason: 'no_rules' }

  const matches = rules
    .map(rule => ({ rule, match: evaluateRule(rule, insp.data ?? {}) }))
    .filter((x): x is { rule: SuggestionRule; match: Match } => !!x.match)
  if (matches.length === 0) return { added: 0, reason: 'no_matches' }

  // Seeds the stop's rows if this is the first read, and tells us what's there.
  const existing = await loadStopLineItems(admin, companyId, stop)
  const { data: dismissed } = await admin
    .from('work_order_line_items').select('suggestion_rule_id')
    .eq('stop_id', stop.id).not('suggestion_rule_id', 'is', null)
  const done = new Set([
    ...existing.map(r => r.suggestion_rule_id),
    ...(dismissed ?? []).map(r => r.suggestion_rule_id as string),
  ].filter(Boolean))
  const fresh = matches.filter(m => !done.has(m.rule.id))
  if (fresh.length === 0) return { added: 0, reason: 'already_suggested' }

  const catalog = await liveCatalog(companyId, actorUserId)
  const nowIso = new Date().toISOString()
  const rows = fresh.flatMap((m, i) => {
    const p = catalog.get(m.rule.jobber_product_id)
    if (!p) return [] // the catalog item was removed from Jobber — skip the rule
    return [{
      company_id: companyId,
      stop_id: stop.id,
      source: 'inspection_suggested',
      status: 'proposed',
      name: p.name,
      description: p.description,
      quantity: m.match.quantity,
      unit_price: p.defaultUnitCost ?? 0,
      taxable: p.taxable,
      jobber_product_id: p.id,
      sync_state: 'synced', // nothing to send until accepted
      suggestion_rule_id: m.rule.id,
      suggestion_note: m.match.note.slice(0, 300),
      added_by: actorUserId || null,
      sort_order: existing.length + i,
      created_at: nowIso,
      updated_at: nowIso,
    }]
  })
  if (rows.length === 0) return { added: 0, reason: 'no_matches' }
  const { error } = await admin.from('work_order_line_items').insert(rows)
  if (error) throw new Error(error.message)
  return { added: rows.length, reason: 'ok' }
}
