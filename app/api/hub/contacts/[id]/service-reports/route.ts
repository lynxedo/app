import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { contactInCompany } from '@/lib/irrigation-server'
import {
  resolveAsrAccess, loadReportStop, prefillFromStop, toFullReport, REPORT_COLS, type ReportRow,
} from '@/lib/after-service-server'
import type { AfterServiceData } from '@/lib/after-service'

// After-service reports for a customer (Work Orders Phase 3 — WF / MO stops).
// Built like …/irrigation: the reports live on the customer file.
//   GET  /api/hub/contacts/:id/service-reports              → drafts + saved history
//   GET  /api/hub/contacts/:id/service-reports?reportId=…   → one report (full)
//   POST /api/hub/contacts/:id/service-reports { stopId }   → start (or resume) the
//        report for that stop's visit. A report always belongs to one visit, so it
//        is started from the stop; the customer file shows and continues them.
//
// Viewing rides on can_access_hub; starting / editing needs the Work Orders grant
// (or Daily Log admin). All writes go through the admin client.

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: contactId } = await params
  const access = await resolveAsrAccess()
  if ('error' in access) return access.error
  const admin = createAdminClient()
  if (!(await contactInCompany(admin, contactId, access.companyId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const reportId = new URL(request.url).searchParams.get('reportId')
  if (reportId) {
    const { data: row } = await admin
      .from('after_service_reports')
      .select(REPORT_COLS)
      .eq('id', reportId)
      .eq('company_id', access.companyId)
      .eq('contact_id', contactId)
      .maybeSingle()
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // Where Send can reach the customer (the Send panel shows these).
    const { data: c } = await admin.from('txt_contacts').select('phone, email, do_not_text').eq('id', contactId).maybeSingle()
    return NextResponse.json({
      canEdit: access.canEdit,
      report: await toFullReport(admin, row as ReportRow),
      contact: { phone: (c?.phone as string | null) ?? null, email: (c?.email as string | null) ?? null, doNotText: c?.do_not_text === true },
    })
  }

  const { data: rows } = await admin
    .from('after_service_reports')
    .select('id, status, data, service_date, finalized_at, sent_at, stop_id, created_by, updated_at')
    .eq('company_id', access.companyId)
    .eq('contact_id', contactId)
    .order('service_date', { ascending: false, nullsFirst: true })
    .order('updated_at', { ascending: false })
    .limit(100)
  const all = (rows ?? []) as { id: string; status: string; data: AfterServiceData; service_date: string | null; finalized_at: string | null; sent_at: string | null; stop_id: string | null; created_by: string | null; updated_at: string }[]

  const ids = Array.from(new Set(all.map(r => r.created_by).filter((x): x is string => !!x)))
  const names = new Map<string, string>()
  if (ids.length > 0) {
    const { data } = await admin.from('hub_users').select('id, display_name').in('id', ids)
    for (const u of data ?? []) names.set(u.id as string, (u.display_name as string) || '')
  }
  const reports = all.map(r => ({
    id: r.id,
    status: r.status === 'final' ? 'final' : 'draft',
    serviceDate: r.service_date,
    finalizedAt: r.finalized_at,
    sentAt: r.sent_at,
    by: r.created_by ? (names.get(r.created_by) ?? null) : null,
    services: (r.data?.services ?? []).map(s => s.name).filter(Boolean),
    stopId: r.stop_id,
  }))
  return NextResponse.json({ canEdit: access.canEdit, reports })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: contactId } = await params
  const access = await resolveAsrAccess()
  if ('error' in access) return access.error
  if (!access.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient()
  if (!(await contactInCompany(admin, contactId, access.companyId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => null) as { stopId?: unknown } | null
  const stopId = typeof body?.stopId === 'string' ? body.stopId : null
  if (!stopId) return NextResponse.json({ error: 'Start the report from the stop on the Work Order list.' }, { status: 400 })

  const stop = await loadReportStop(admin, access.companyId, stopId)
  if (!stop) return NextResponse.json({ error: 'That work order was not found.' }, { status: 404 })
  if (stop.contact_id && stop.contact_id !== contactId) {
    return NextResponse.json({ error: 'That work order belongs to a different customer.' }, { status: 409 })
  }

  // One report per visit (or per stop when the stop has no visit id).
  const existingQ = admin.from('after_service_reports').select(REPORT_COLS).eq('company_id', access.companyId)
  const { data: existing } = stop.jobber_visit_id
    ? await existingQ.eq('jobber_visit_id', stop.jobber_visit_id).maybeSingle()
    : await existingQ.eq('stop_id', stop.id).maybeSingle()

  if (existing) {
    let row = existing as ReportRow
    // A saved report opens as itself; a draft is refreshed from the stop (a line
    // item added since it was started shows up) and re-pointed at this stop.
    if (row.status === 'draft') {
      const data = await prefillFromStop(admin, access.companyId, stop, row.data ?? {})
      const { data: updated } = await admin
        .from('after_service_reports')
        .update({ data, stop_id: stop.id, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('status', 'draft')
        .select(REPORT_COLS)
        .maybeSingle()
      if (updated) row = updated as ReportRow
    }
    return NextResponse.json({ report: await toFullReport(admin, row), resumed: true })
  }

  const data = await prefillFromStop(admin, access.companyId, stop, {})
  const { data: created, error } = await admin
    .from('after_service_reports')
    .insert({
      company_id: access.companyId,
      contact_id: contactId,
      stop_id: stop.id,
      jobber_visit_id: stop.jobber_visit_id,
      pesticide_record_id: stop.pesticide_record_id,
      status: 'draft',
      data,
      service_date: stop.log_date,
      created_by: access.userId,
      updated_by: access.userId,
    })
    .select(REPORT_COLS)
    .single()
  if (error || !created) {
    // Two taps at once — the unique index caught the second; open the first.
    if (error?.code === '23505') {
      const again = admin.from('after_service_reports').select(REPORT_COLS).eq('company_id', access.companyId)
      const { data: row } = stop.jobber_visit_id
        ? await again.eq('jobber_visit_id', stop.jobber_visit_id).maybeSingle()
        : await again.eq('stop_id', stop.id).maybeSingle()
      if (row) return NextResponse.json({ report: await toFullReport(admin, row as ReportRow), resumed: true })
    }
    return NextResponse.json({ error: error?.message || 'Could not start the report' }, { status: 500 })
  }
  return NextResponse.json({ report: await toFullReport(admin, created as ReportRow) })
}
