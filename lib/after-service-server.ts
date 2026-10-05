import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { createAdminClient } from '@/lib/supabase/admin'
import { r2SignedUrl } from '@/lib/r2'
import { matchChemicalsForLineItems } from '@/lib/pesticide'
import { loadStopLineItems, asStopLineItems } from '@/lib/work-order-line-items'
import { mergeMappedProducts, type AfterServiceData, type AsrProduct } from '@/lib/after-service'

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
