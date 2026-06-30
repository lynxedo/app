// lib/pesticide.ts
// Master PRD Session 9 — unified pesticide records.
//
// One matcher + one record store, shared by both completion paths:
//   1. Daily Log V2 "mark stop complete" (app/api/hub/daily-log/stops/[id]/complete)
//   2. Jobber VISIT_COMPLETE webhook (lib/jobber-sync.ts → processJobberWebhookEvent)
//
// Both match a visit's line items against `service_products` → `products`
// (the single source of truth, PRD §8.8) and write a `pesticide_records` row.
// Records dedupe on (company_id, jobber_visit_id) via a partial unique index
// (migration session9_pesticide_visit_dedup). DL V2 is the primary path (real
// arrival-time weather + technician); the webhook only fills in visits that were
// completed directly in Jobber, and never clobbers a DL V2 record.

import type { SupabaseClient } from '@supabase/supabase-js'
import { geocodeAddress } from '@/lib/geocode'
import { fetchWeatherForLocation } from '@/lib/nws-weather'
import { selectMappingsForDate, todayInTz } from '@/lib/service-mapping'

// A line item as it appears on a stop or a synced Jobber visit.
export type RecordLineItem = {
  name?: string
  qty?: number
  unitPrice?: number
  totalPrice?: number
}

// One entry in pesticide_records.chemicals_applied. The first block of keys is
// the shape the viewer + CSV export already read (keep them); the rest are
// richer audit fields that downstream consumers ignore if unknown.
export type ChemicalApplied = {
  matched_line_item: string
  matched_line_item_qty: number | null
  matched_line_item_total: number | null
  chemical_name: string
  epa_registration_number: string | null
  active_ingredients: string | null
  target_pests: string | null
  application_rate: string | null
  // ── audit extras (Session 9) ──
  product_id: string
  service_product_id: string
  program: string | null
  tank: number | null
  batch_number: string | null
  batch_date: string | null
}

type ProductJoin = {
  id: string
  name: string
  epa_reg_number: string | null
  active_ingredient: string | null
  application_rate: number | null
  rate_basis: string
  unit: string | null
  batch_number: string | null
  batch_date: string | null
}

type ServiceProductRow = {
  id: string
  jobber_line_item_name: string
  match_type: 'contains' | 'exact'
  application_rate: number | null
  rate_unit: string | null
  program: string | null
  tank_default: number | null
  effective_start: string | null
  effective_end: string | null
  batch_label: string | null
  products: ProductJoin | null
}

// Build a human-readable rate string from the product's numeric rate + basis,
// e.g. "0.1 oz/1,000 sq ft" or "2 oz/gal". A service_products rate_unit override
// wins when present.
function formatRate(
  rate: number | null,
  overrideUnit: string | null,
  basis: string,
  productUnit: string | null,
): string | null {
  if (rate == null) return null
  if (overrideUnit) return `${rate} ${overrideUnit}`.trim()
  const u = productUnit ?? ''
  if (basis === 'per_gallon') return `${rate} ${u}/gal`.replace(/\s+/g, ' ').trim()
  if (basis === 'per_1000sqft') return `${rate} ${u}/1,000 sq ft`.replace(/\s+/g, ' ').trim()
  return `${rate} ${u}`.trim()
}

/**
 * Match a visit/stop's line items against the company's active service_products
 * mappings (joined to products) and return the chemicals_applied array. A line
 * item can map to several products; the same (line item, product) pair is only
 * recorded once. Mappings with no linked product are skipped (not a chemical).
 *
 * `asOf` (YYYY-MM-DD) is the service date — the mix can change through the year,
 * so per line item only the batch in effect that day is used (see
 * selectMappingsForDate). Defaults to today (Central) when omitted.
 *
 * Empty line items, no mappings, or no matches all return [].
 * Uses the admin/service-role client (RLS bypassed) — callers already scope by company.
 */
export async function matchChemicalsForLineItems(
  admin: SupabaseClient,
  companyId: string,
  lineItems: RecordLineItem[],
  asOf?: string,
): Promise<ChemicalApplied[]> {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return []

  const { data: rows } = await admin
    .from('service_products')
    .select(
      'id, jobber_line_item_name, match_type, application_rate, rate_unit, program, tank_default,' +
      ' effective_start, effective_end, batch_label,' +
      ' products:product_id(id, name, epa_reg_number, active_ingredient, application_rate, rate_basis, unit, batch_number, batch_date)',
    )
    .eq('company_id', companyId)
    .eq('is_active', true)
    .is('deleted_at', null)

  // PostgREST types the embedded relation as an array; it's a to-one FK here.
  const allRows = ((rows ?? []) as unknown as ServiceProductRow[]).map(m => ({
    ...m,
    products: Array.isArray(m.products) ? (m.products[0] ?? null) : m.products,
  }))
  // Keep only the mix batch in effect on the service date, per line item.
  const mappings = selectMappingsForDate(allRows, asOf ?? todayInTz())
  if (mappings.length === 0) return []

  const result: ChemicalApplied[] = []
  const seen = new Set<string>()

  for (const item of lineItems) {
    const itemName = (item?.name ?? '').trim().toLowerCase()
    if (!itemName) continue
    for (const m of mappings) {
      const product = m.products
      if (!product) continue
      const needle = m.jobber_line_item_name.trim().toLowerCase()
      if (!needle) continue
      const hit = m.match_type === 'exact' ? itemName === needle : itemName.includes(needle)
      if (!hit) continue

      const key = `${itemName}|${product.id}`
      if (seen.has(key)) continue
      seen.add(key)

      const rate = m.application_rate ?? product.application_rate
      result.push({
        matched_line_item: item.name ?? '',
        matched_line_item_qty: typeof item.qty === 'number' ? item.qty : null,
        matched_line_item_total: typeof item.totalPrice === 'number' ? item.totalPrice : null,
        chemical_name: product.name,
        epa_registration_number: product.epa_reg_number,
        active_ingredients: product.active_ingredient,
        target_pests: null,
        application_rate: formatRate(rate, m.rate_unit, product.rate_basis, product.unit),
        product_id: product.id,
        service_product_id: m.id,
        program: m.program,
        tank: m.tank_default,
        batch_number: product.batch_number,
        batch_date: product.batch_date,
      })
    }
  }
  return result
}

/**
 * Create a pesticide_records row from a completed Jobber visit (webhook path).
 * Best-effort and idempotent: deduped on (company_id, jobber_visit_id) via
 * ON CONFLICT DO NOTHING, so it never overwrites a Daily Log V2 record (the
 * primary path) regardless of which fires first.
 *
 * Returns 'created' | 'duplicate' | 'no_chemicals' | 'not_complete' | 'no_visit'.
 * Caller (jobber-sync) should run this only after the visit row has been synced.
 */
export async function createPesticideRecordFromJobberVisit(args: {
  admin: SupabaseClient
  companyId: string
  jobberVisitId: string
  occurredAt?: string | null
}): Promise<'created' | 'duplicate' | 'no_chemicals' | 'not_complete' | 'no_visit'> {
  const { admin, companyId, jobberVisitId, occurredAt } = args

  // The visit was just synced into our mirror — read it back.
  const { data: visit } = await admin
    .from('visits')
    .select('completed_at, visit_status, job_external_id, client_external_id, tech_external_user_ids')
    .eq('company_id', companyId)
    .eq('external_id', jobberVisitId)
    .eq('source', 'jobber')
    .maybeSingle<{
      completed_at: string | null
      visit_status: string | null
      job_external_id: string | null
      client_external_id: string | null
      tech_external_user_ids: string[] | null
    }>()

  if (!visit) return 'no_visit'

  // Only record completed visits.
  const isComplete = Boolean(visit.completed_at) ||
    (visit.visit_status ?? '').toUpperCase().includes('COMPLET')
  if (!isComplete) return 'not_complete'

  // Fast dedup: if a record already exists for this visit (DL V2 or a prior
  // webhook), do nothing. The ON CONFLICT below is the real guard against races.
  {
    const { data: existing } = await admin
      .from('pesticide_records')
      .select('id')
      .eq('company_id', companyId)
      .eq('jobber_visit_id', jobberVisitId)
      .maybeSingle()
    if (existing) return 'duplicate'
  }

  // Visit line items live in the line_items mirror, keyed by parent visit.
  const { data: liRows } = await admin
    .from('line_items')
    .select('name, quantity, total')
    .eq('company_id', companyId)
    .eq('parent_type', 'visit')
    .eq('parent_external_id', jobberVisitId)
    .eq('source', 'jobber')

  const lineItems: RecordLineItem[] = (liRows ?? []).map(r => ({
    name: r.name ?? undefined,
    qty: typeof r.quantity === 'number' ? r.quantity : undefined,
    totalPrice: typeof r.total === 'number' ? r.total : undefined,
  }))

  // The mix in effect on the day this visit was completed (mixes change through
  // the year). Falls back to today when the visit carries no completion time.
  const asOf = (visit.completed_at ?? occurredAt ?? new Date().toISOString()).slice(0, 10)
  const chemicals = await matchChemicalsForLineItems(admin, companyId, lineItems, asOf)
  if (chemicals.length === 0) return 'no_chemicals'

  // Customer + property/address for the record. Best-effort lookups.
  let customerName: string | null = null
  if (visit.client_external_id) {
    const { data: client } = await admin
      .from('clients')
      .select('name')
      .eq('company_id', companyId)
      .eq('external_id', visit.client_external_id)
      .eq('source', 'jobber')
      .maybeSingle<{ name: string | null }>()
    customerName = client?.name ?? null
  }

  let address: string | null = null
  let lat: number | null = null
  let lng: number | null = null
  if (visit.job_external_id) {
    const { data: job } = await admin
      .from('jobs')
      .select('property_external_id')
      .eq('company_id', companyId)
      .eq('external_id', visit.job_external_id)
      .eq('source', 'jobber')
      .maybeSingle<{ property_external_id: string | null }>()
    if (job?.property_external_id) {
      const { data: prop } = await admin
        .from('properties')
        .select('address_line1, city, state, zip, latitude, longitude')
        .eq('company_id', companyId)
        .eq('external_id', job.property_external_id)
        .eq('source', 'jobber')
        .maybeSingle<{
          address_line1: string | null; city: string | null; state: string | null
          zip: string | null; latitude: number | null; longitude: number | null
        }>()
      if (prop) {
        address = [prop.address_line1, prop.city, prop.state, prop.zip]
          .filter(Boolean).join(', ') || null
        lat = prop.latitude
        lng = prop.longitude
      }
    }
  }

  // Geocode if the property has no stored coords (the sync stores null), then
  // pull weather. Both best-effort — a missing weather snapshot never blocks
  // the compliance record.
  if ((lat == null || lng == null) && address) {
    try {
      const geo = await geocodeAddress(address)
      if (geo) { lat = geo.lat; lng = geo.lng }
    } catch { /* best-effort */ }
  }
  let weather = null
  if (lat != null && lng != null) {
    try { weather = await fetchWeatherForLocation(lat, lng) } catch { /* best-effort */ }
  }

  const applicationTimestamp = visit.completed_at ?? occurredAt ?? new Date().toISOString()

  const recordBody = {
    company_id: companyId,
    stop_id: null,
    daily_log_entry_id: null,
    application_timestamp: applicationTimestamp,
    location_address: address,
    location_lat: lat,
    location_lng: lng,
    customer_name: customerName,
    jobber_visit_id: jobberVisitId,
    jobber_client_id: visit.client_external_id,
    technician_user_id: null,
    // No Jobber-user → name mapping in the mirror; DL V2 is the path with real
    // technician names. Left null for directly-in-Jobber completions (v1).
    technician_name: null,
    line_items: lineItems,
    chemicals_applied: chemicals,
    weather,
    notes: 'Auto-created from Jobber visit completion',
    tech_notes: null,
  }

  // Plain INSERT. The dedup key is a PARTIAL unique index
  // (company_id, jobber_visit_id) WHERE jobber_visit_id IS NOT NULL — a plain
  // PostgREST ON CONFLICT cannot target a partial index (Postgres 42P10), which
  // silently dropped every record (test-findings #10, same shape as #6). Insert
  // directly; a genuine duplicate (race with the DL V2 path) raises 23505, which
  // we treat as "already logged."
  const { error } = await admin
    .from('pesticide_records')
    .insert(recordBody)
  if (error) {
    // 23505 = unique violation: the DL V2 path already logged this visit. Any
    // other error is a real failure worth surfacing (was masked by the upsert).
    if (error.code !== '23505') {
      console.error('[pesticide] webhook record insert failed:', error.message)
    }
    return 'duplicate'
  }
  return 'created'
}
