import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { createAdminClient } from '@/lib/supabase/admin'
import { r2SignedUrl } from '@/lib/r2'
import { matchChemicalsForLineItems } from '@/lib/pesticide'
import { loadStopLineItems, asStopLineItems } from '@/lib/work-order-line-items'
import { mergeMappedProducts, customerServiceName, type AfterServiceData, type AsrProduct, type AsrTreatment } from '@/lib/after-service'

// Server-only helpers for the after-service report routes (Work Orders Phase 3):
// the access gate, the stop a report is done from, the pre-fill from that stop
// (services + mapped products), and writing the tech's product confirmation
// into the pesticide record. Mirrors lib/irrigation-server.ts.

type Admin = ReturnType<typeof createAdminClient>

export type AsrAccess = { userId: string; companyId: string; canEdit: boolean }

/**
 * Any signed-in same-company user with Hub access may read a report (it is on
 * the customer file). Starting / editing / saving needs the Work Orders grant
 * (can_access_daily_log_v2) or Daily Log admin rights — the techs who do the work.
 */
export async function resolveAsrAccess(): Promise<AsrAccess | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_access_hub, can_admin_daily_log, can_access_daily_log_v2')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id || !profile.can_access_hub) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const canEdit = profile.role === 'admin' || profile.can_admin_daily_log === true || profile.can_access_daily_log_v2 === true
  return { userId: user.id, companyId: profile.company_id as string, canEdit }
}

export type ReportStop = {
  id: string
  status: string
  contact_id: string | null
  jobber_visit_id: string | null
  jobber_job_id: string | null
  line_items: unknown
  weather: AfterServiceData['weather'] | null
  pesticide_record_id: string | null
  log_date: string
  tech_user_id: string | null
}

/** The stop, scoped to the company, with its day. Null when it isn't this company's. */
export async function loadReportStop(admin: Admin, companyId: string, stopId: string): Promise<ReportStop | null> {
  const { data } = await admin
    .from('daily_log_stops')
    .select('id, status, contact_id, jobber_visit_id, jobber_job_id, line_items, weather, pesticide_record_id, entry:daily_log_entries!entry_id(company_id, log_date, tech_user_id)')
    .eq('id', stopId)
    .maybeSingle()
  const row = data as unknown as (Omit<ReportStop, 'log_date' | 'tech_user_id'> & { entry: { company_id: string; log_date: string; tech_user_id: string | null } | null }) | null
  if (!row || !row.entry || row.entry.company_id !== companyId) return null
  const { entry, ...rest } = row
  return { ...rest, log_date: entry.log_date, tech_user_id: entry.tech_user_id }
}

/**
 * Fill the parts of the report that come from the stop: what was done (the work
 * order's accepted line items) and the products the pesticide mapping says those
 * services use. Runs when a draft is started or resumed and again when it is
 * saved, so a line item the tech added in the meantime shows up. Answers the
 * tech already gave are kept (mergeMappedProducts).
 */
export async function prefillFromStop(admin: Admin, companyId: string, stop: ReportStop, data: AfterServiceData): Promise<AfterServiceData> {
  const rows = await loadStopLineItems(admin, companyId, stop)
  const items = rows.length > 0
    ? asStopLineItems(rows)
    : (Array.isArray(stop.line_items) ? (stop.line_items as { name?: string; qty?: number }[]) : [])
        .filter(li => li?.name)
        .map(li => ({ name: String(li.name), qty: typeof li.qty === 'number' ? li.qty : 1, unitPrice: 0, totalPrice: 0 }))

  const services = items.map(li => ({ name: li.name, qty: li.qty }))
  const chemicals = await matchChemicalsForLineItems(admin, companyId, items, stop.log_date)

  // One row per product, even when two services bring the same one in.
  const mapped = new Map<string, AsrProduct>()
  for (const c of chemicals) {
    const prior = mapped.get(c.product_id)
    if (prior) {
      if (c.matched_line_item && !(prior.forService ?? '').includes(c.matched_line_item)) {
        prior.forService = [prior.forService, c.matched_line_item].filter(Boolean).join(', ')
      }
      continue
    }
    mapped.set(c.product_id, {
      key: c.product_id,
      productId: c.product_id,
      name: c.chemical_name,
      epa: c.epa_registration_number,
      mappedRate: c.application_rate,
      forService: c.matched_line_item || null,
      applied: '', amount: '', note: '',
    })
  }

  return {
    ...data,
    services,
    treatments: await resolveTreatments(admin, companyId, services.filter(s => s.qty > 0).map(s => s.name), stop.log_date),
    products: mergeMappedProducts(data.products ?? [], Array.from(mapped.values())),
    weather: stop.weather
      ? {
          temperature_f: stop.weather.temperature_f ?? null,
          conditions: stop.weather.conditions ?? null,
          wind_mph: stop.weather.wind_mph ?? null,
          humidity_pct: stop.weather.humidity_pct ?? null,
        }
      : (data.weather ?? null),
  }
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * The customer-facing words for each service on the visit: the office's Report
 * text (after_service_templates) whose service name the line item contains —
 * longest match wins — preferring the wording for the round in effect on the
 * visit date (from Service Mapping: the active, dated batch for that line item)
 * over the every-round wording. A service with no text is left out.
 */
export async function resolveTreatments(admin: Admin, companyId: string, serviceNames: string[], date: string): Promise<AsrTreatment[]> {
  const names = Array.from(new Set(serviceNames.filter(Boolean)))
  if (names.length === 0) return []
  const { data: tpls } = await admin
    .from('after_service_templates')
    .select('service_name, round_label, description, care')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .is('deleted_at', null)
  const templates = (tpls ?? []) as { service_name: string; round_label: string | null; description: string; care: string }[]
  if (templates.length === 0) return []

  // The round in effect that day, per line item (Service Mapping batch label).
  const { data: batches } = await admin
    .from('service_products')
    .select('jobber_line_item_name, match_type, batch_label, effective_start, effective_end')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .not('batch_label', 'is', null)
  const roundFor = (item: string): string | null => {
    const n = norm(item)
    let best: { label: string; start: string } | null = null
    for (const b of (batches ?? []) as { jobber_line_item_name: string; match_type: string; batch_label: string; effective_start: string | null; effective_end: string | null }[]) {
      const needle = norm(b.jobber_line_item_name ?? '')
      if (!needle) continue
      const hit = b.match_type === 'exact' ? n === needle : n.includes(needle)
      if (!hit) continue
      if (b.effective_start && date < b.effective_start) continue
      if (b.effective_end && date > b.effective_end) continue
      // Overlapping rounds: the most recently started wins (Service Mapping's rule).
      const start = b.effective_start ?? ''
      if (!best || start > best.start) best = { label: b.batch_label, start }
    }
    return best?.label ?? null
  }

  const out: AsrTreatment[] = []
  for (const item of names) {
    const n = norm(item)
    const matching = templates.filter(t => t.service_name.trim() && n.includes(norm(t.service_name)))
    if (matching.length === 0) continue
    const longest = Math.max(...matching.map(t => norm(t.service_name).length))
    const pool = matching.filter(t => norm(t.service_name).length === longest)
    const round = roundFor(item)
    const pick = (round ? pool.find(t => t.round_label && norm(t.round_label) === norm(round)) : undefined)
      ?? pool.find(t => !t.round_label)
    if (!pick) continue
    out.push({
      service: item,
      display: customerServiceName(item),
      round,
      description: pick.description ?? '',
      care: pick.care ?? '',
    })
  }
  return out
}

export type ReportRow = {
  id: string; status: string; data: AfterServiceData; photo_keys: string[] | null
  contact_id: string; stop_id: string | null; jobber_visit_id: string | null; pesticide_record_id: string | null
  service_date: string | null; finalized_at: string | null; sent_at: string | null; sent_via: string[] | null
  share_token: string | null; share_expires_at: string | null
  created_by: string | null; updated_by: string | null; updated_at: string
}

export const REPORT_COLS =
  'id, status, data, photo_keys, contact_id, stop_id, jobber_visit_id, pesticide_record_id, service_date, finalized_at, sent_at, sent_via, share_token, share_expires_at, created_by, updated_by, updated_at'

export type WorkOrderRef = { stopId: string; date: string; tech: string | null; status: string }

/** The report as the client sees it: signed photo URLs, names, and its work order. */
export async function toFullReport(admin: Admin, row: ReportRow) {
  const photoUrls = await Promise.all((row.photo_keys ?? []).map(k => r2SignedUrl(k, 3600).catch(() => null)))
  const userIds = [row.created_by, row.updated_by].filter((x): x is string => !!x)
  const names = new Map<string, string>()
  if (userIds.length > 0) {
    const { data } = await admin.from('hub_users').select('id, display_name').in('id', userIds)
    for (const u of data ?? []) names.set(u.id as string, (u.display_name as string) || '')
  }
  let workOrder: WorkOrderRef | null = null
  if (row.stop_id) {
    const { data } = await admin
      .from('daily_log_stops')
      .select('id, status, entry:daily_log_entries!entry_id(log_date, tech:hub_users!tech_user_id(display_name))')
      .eq('id', row.stop_id)
      .maybeSingle()
    const s = data as unknown as { id: string; status: string; entry: { log_date: string; tech: { display_name: string } | null } | null } | null
    if (s?.entry) workOrder = { stopId: s.id, date: s.entry.log_date, tech: s.entry.tech?.display_name ?? null, status: s.status }
  }
  const pairs = (row.photo_keys ?? []).map((key, i) => ({ key, url: photoUrls[i] })).filter(p => !!p.url)
  const shareActive = !!row.share_token && (!row.share_expires_at || new Date(row.share_expires_at) > new Date())
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
  return {
    id: row.id,
    status: row.status,
    data: row.data ?? {},
    photoKeys: pairs.map(p => p.key),
    photoUrls: pairs.map(p => p.url as string),
    serviceDate: row.service_date,
    finalizedAt: row.finalized_at,
    sentAt: row.sent_at,
    sentVia: row.sent_via ?? [],
    by: row.created_by ? (names.get(row.created_by) ?? null) : null,
    stopId: row.stop_id,
    jobberVisitId: row.jobber_visit_id,
    pesticideRecordId: row.pesticide_record_id,
    workOrder,
    shareUrl: shareActive ? `${baseUrl}/report/${row.share_token}` : null,
  }
}

/**
 * Write the tech's product confirmation onto the visit's pesticide record —
 * next to the mapped `chemicals_applied`, never over it. `tech_confirmation` is
 * an append-only list: each save of the report adds an entry (an unchanged
 * re-save adds nothing), so the record shows what the mapping said AND every
 * time the tech confirmed or corrected it.
 *
 * The record is written when the stop is completed, which may be before or after
 * the report is saved — so this runs from both places. No record yet → nothing
 * to do; the completion will call it again.
 */
export async function syncConfirmationToPesticideRecord(admin: Admin, companyId: string, reportId: string): Promise<'written' | 'unchanged' | 'no_record' | 'not_final'> {
  const { data: rep } = await admin
    .from('after_service_reports')
    .select('id, status, data, stop_id, jobber_visit_id, pesticide_record_id, finalized_at, updated_by')
    .eq('id', reportId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (!rep || rep.status !== 'final') return 'not_final'

  let recordId = (rep.pesticide_record_id as string | null) ?? null
  if (!recordId && rep.stop_id) {
    const { data: s } = await admin.from('daily_log_stops').select('pesticide_record_id').eq('id', rep.stop_id).maybeSingle()
    recordId = (s?.pesticide_record_id as string | null) ?? null
  }
  if (!recordId && rep.jobber_visit_id) {
    const { data: r } = await admin
      .from('pesticide_records').select('id').eq('company_id', companyId).eq('jobber_visit_id', rep.jobber_visit_id).maybeSingle()
    recordId = (r?.id as string | null) ?? null
  }
  if (!recordId && rep.stop_id) recordId = await createRecordFromReport(admin, companyId, rep.stop_id, (rep.data as AfterServiceData) ?? {})
  if (!recordId) return 'no_record'

  const { data: record } = await admin
    .from('pesticide_records').select('id, tech_confirmation').eq('id', recordId).eq('company_id', companyId).maybeSingle()
  if (!record) return 'no_record'

  let confirmedBy: string | null = null
  if (rep.updated_by) {
    const { data: u } = await admin.from('hub_users').select('display_name').eq('id', rep.updated_by).maybeSingle()
    confirmedBy = (u?.display_name as string | null) ?? null
  }
  const products = ((rep.data as AfterServiceData)?.products ?? [])
    .filter(p => p.name.trim())
    .map(p => ({
      chemical_name: p.name.trim(),
      product_id: p.productId,
      epa_registration_number: p.epa,
      mapped_rate: p.mappedRate,
      applied: p.applied === 'yes',
      // Blank = the tech used the mapped rate (the form says so).
      amount_applied: p.amount.trim() || (p.applied === 'yes' ? p.mappedRate : null),
      amount_as_mapped: p.applied === 'yes' && !p.amount.trim(),
      note: p.note.trim() || null,
      added_by_tech: !!p.added,
    }))

  const history = Array.isArray(record.tech_confirmation) ? (record.tech_confirmation as { products?: unknown }[]) : []
  const last = history[history.length - 1]
  if (last && JSON.stringify(last.products) === JSON.stringify(products)) {
    if (!rep.pesticide_record_id) await admin.from('after_service_reports').update({ pesticide_record_id: recordId }).eq('id', rep.id)
    return 'unchanged'
  }
  const entry = {
    report_id: rep.id,
    confirmed_by_user_id: rep.updated_by ?? null,
    confirmed_by: confirmedBy,
    confirmed_at: rep.finalized_at ?? new Date().toISOString(),
    products,
  }
  await admin.from('pesticide_records')
    .update({ tech_confirmation: [...history, entry], updated_at: new Date().toISOString() })
    .eq('id', recordId)
  if (!rep.pesticide_record_id) await admin.from('after_service_reports').update({ pesticide_record_id: recordId }).eq('id', rep.id)
  return 'written'
}

/** The final report for a stop's visit, if any — for the completion path. */
export async function finalReportIdForStop(admin: Admin, companyId: string, stop: { id: string; jobber_visit_id: string | null }): Promise<string | null> {
  const q = admin.from('after_service_reports').select('id').eq('company_id', companyId).eq('status', 'final')
  const { data } = stop.jobber_visit_id
    ? await q.eq('jobber_visit_id', stop.jobber_visit_id).maybeSingle()
    : await q.eq('stop_id', stop.id).maybeSingle()
  return (data?.id as string | null) ?? null
}

/**
 * A stop whose services map to NO products gets no pesticide record when it is
 * completed — but if the tech's report says they applied something, the visit
 * needs one. Create it from the stop (same fields the completion writes), with
 * the tech's applied products as `chemicals_applied`. Only once the stop is
 * complete (that is when the application is a fact), and only when nothing was
 * recorded for the visit already.
 */
async function createRecordFromReport(admin: Admin, companyId: string, stopId: string, data: AfterServiceData): Promise<string | null> {
  const applied = (data.products ?? []).filter(p => p.applied === 'yes' && p.name.trim())
  if (applied.length === 0) return null
  const { data: stop } = await admin
    .from('daily_log_stops')
    .select('id, entry_id, status, jobber_visit_id, jobber_client_id, client_name, address, lat, lng, line_items, weather, arrived_at, completed_at, pesticide_record_id, pesticide_tech_notes, entry:daily_log_entries!entry_id(company_id, tech_user_id)')
    .eq('id', stopId)
    .maybeSingle()
  const st = stop as unknown as {
    id: string; entry_id: string; status: string; jobber_visit_id: string | null; jobber_client_id: string | null
    client_name: string | null; address: string | null; lat: number | null; lng: number | null; line_items: unknown
    weather: unknown; arrived_at: string | null; completed_at: string | null; pesticide_record_id: string | null
    pesticide_tech_notes: string | null; entry: { company_id: string; tech_user_id: string | null } | null
  } | null
  if (!st || st.entry?.company_id !== companyId || st.status !== 'complete') return null
  if (st.pesticide_record_id) return st.pesticide_record_id

  const ids = applied.map(p => p.productId).filter((x): x is string => !!x)
  const products = new Map<string, { epa_reg_number: string | null; active_ingredient: string | null }>()
  if (ids.length > 0) {
    const { data: rows } = await admin.from('products').select('id, epa_reg_number, active_ingredient').in('id', ids)
    for (const r of rows ?? []) products.set(r.id as string, { epa_reg_number: r.epa_reg_number as string | null, active_ingredient: r.active_ingredient as string | null })
  }
  let technicianName: string | null = null
  if (st.entry?.tech_user_id) {
    const { data: u } = await admin.from('hub_users').select('display_name').eq('id', st.entry.tech_user_id).maybeSingle()
    technicianName = (u?.display_name as string | null) ?? null
  }
  const chemicals = applied.map(p => ({
    matched_line_item: p.forService ?? 'Added by technician',
    matched_line_item_qty: null,
    matched_line_item_total: null,
    chemical_name: p.name.trim(),
    epa_registration_number: (p.productId && products.get(p.productId)?.epa_reg_number) || p.epa || null,
    active_ingredients: (p.productId && products.get(p.productId)?.active_ingredient) || null,
    target_pests: null,
    application_rate: p.amount.trim() || p.mappedRate || null,
    product_id: p.productId,
    service_product_id: null,
    program: null,
    tank: null,
    batch_number: null,
    batch_date: null,
  }))
  const { data: created, error } = await admin
    .from('pesticide_records')
    .insert({
      company_id: companyId,
      stop_id: st.id,
      daily_log_entry_id: st.entry_id,
      application_timestamp: st.arrived_at ?? st.completed_at ?? new Date().toISOString(),
      location_address: st.address,
      location_lat: st.lat,
      location_lng: st.lng,
      customer_name: st.client_name,
      jobber_visit_id: st.jobber_visit_id,
      jobber_client_id: st.jobber_client_id,
      technician_user_id: st.entry?.tech_user_id ?? null,
      technician_name: technicianName,
      line_items: Array.isArray(st.line_items) ? st.line_items : [],
      chemicals_applied: chemicals,
      weather: st.weather ?? null,
      notes: 'Created from the after-service report — the services on this visit have no mapped products, the technician recorded these.',
      tech_notes: st.pesticide_tech_notes,
    })
    .select('id')
    .single()
  if (error || !created) {
    // 23505: the visit already has a record (a race with the completion path).
    if (error?.code === '23505' && st.jobber_visit_id) {
      const { data: r } = await admin.from('pesticide_records').select('id').eq('company_id', companyId).eq('jobber_visit_id', st.jobber_visit_id).maybeSingle()
      return (r?.id as string | null) ?? null
    }
    console.error('[after-service] pesticide record from report failed:', error?.message)
    return null
  }
  await admin.from('daily_log_stops').update({ pesticide_record_id: created.id }).eq('id', st.id)
  return created.id as string
}
