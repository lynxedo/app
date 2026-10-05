import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { contactInCompany } from '@/lib/irrigation-server'
import {
  resolveAsrAccess, loadReportStop, prefillFromStop, syncConfirmationToPesticideRecord, REPORT_COLS, type ReportRow,
} from '@/lib/after-service-server'
import { unansweredProducts, type AfterServiceData } from '@/lib/after-service'

// One after-service report.
//   PATCH  … /service-reports/:reportId                      → autosave the draft
//   POST   … /service-reports/:reportId                      → save it (draft → final)
//   POST   … /service-reports/:reportId { action:'reopen' }  → back to a draft to fix
//          something (only before it has been sent to the customer)
//   DELETE … /service-reports/:reportId                      → discard the draft
// All need the Work Orders grant.

type Ctx = { params: Promise<{ id: string; reportId: string }> }

const MAX_DATA_BYTES = 200_000

async function gate(ctx: Ctx) {
  const { id: contactId, reportId } = await ctx.params
  const access = await resolveAsrAccess()
  if ('error' in access) return { error: access.error }
  if (!access.canEdit) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const admin = createAdminClient()
  if (!(await contactInCompany(admin, contactId, access.companyId))) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  const { data: row } = await admin
    .from('after_service_reports')
    .select(REPORT_COLS)
    .eq('id', reportId)
    .eq('company_id', access.companyId)
    .eq('contact_id', contactId)
    .maybeSingle()
  if (!row) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { access, admin, contactId, report: row as ReportRow }
}

function readBody(body: Record<string, unknown>): { data?: AfterServiceData; photo_keys?: string[]; error?: string } {
  const out: { data?: AfterServiceData; photo_keys?: string[]; error?: string } = {}
  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    if (JSON.stringify(body.data).length > MAX_DATA_BYTES) return { error: 'The report is too large to save.' }
    out.data = body.data as AfterServiceData
  }
  if (Array.isArray(body.photo_keys)) out.photo_keys = body.photo_keys.filter((k): k is string => typeof k === 'string').slice(0, 40)
  return out
}

export async function PATCH(request: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const { access, admin, report } = g
  if (report.status !== 'draft') return NextResponse.json({ error: 'This report is saved — reopen it to change it.' }, { status: 409 })

  const parsed = readBody(await request.json().catch(() => ({})))
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 413 })
  const update: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: access.userId }
  if (parsed.data) update.data = parsed.data
  if (parsed.photo_keys) update.photo_keys = parsed.photo_keys

  const { data, error } = await admin
    .from('after_service_reports')
    .update(update)
    .eq('id', report.id)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'No editable draft found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function POST(request: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const { access, admin, report } = g
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const now = new Date().toISOString()

  if (body.action === 'reopen') {
    if (report.status !== 'final') return NextResponse.json({ ok: true })
    if (report.sent_at) {
      return NextResponse.json({ error: 'This report was already sent to the customer, so it can’t be changed.' }, { status: 409 })
    }
    const { error } = await admin
      .from('after_service_reports')
      .update({ status: 'draft', finalized_at: null, updated_at: now, updated_by: access.userId })
      .eq('id', report.id)
      .eq('status', 'final')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (report.status !== 'draft') return NextResponse.json({ error: 'No draft to save' }, { status: 404 })
  const parsed = readBody(body)
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 413 })

  // Last look at the stop: what was done may have changed since the draft opened.
  let data: AfterServiceData = parsed.data ?? report.data ?? {}
  if (report.stop_id) {
    const stop = await loadReportStop(admin, access.companyId, report.stop_id)
    if (stop) data = await prefillFromStop(admin, access.companyId, stop, data)
  }
  // Products are the TDA side of the report — each one needs an answer.
  const missing = unansweredProducts(data)
  if (missing.length > 0) {
    return NextResponse.json({
      error: `Mark ${missing.length === 1 ? `“${missing[0].name}”` : `${missing.length} products`} as Applied or Not applied first.`,
      data,
    }, { status: 422 })
  }
  data = { ...data, products: (data.products ?? []).filter(p => p.name.trim()) }

  const update: Record<string, unknown> = {
    status: 'final', finalized_at: now, updated_at: now, updated_by: access.userId, data,
  }
  if (parsed.photo_keys) update.photo_keys = parsed.photo_keys
  const { data: saved, error } = await admin
    .from('after_service_reports')
    .update(update)
    .eq('id', report.id)
    .eq('status', 'draft')
    .select('id, finalized_at')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!saved) return NextResponse.json({ error: 'No draft to save' }, { status: 404 })

  // The tech's confirmation goes onto the visit's pesticide record now if the
  // stop is already complete; otherwise the completion writes it.
  let pesticide: string = 'no_record'
  try { pesticide = await syncConfirmationToPesticideRecord(admin, access.companyId, report.id) }
  catch (e) { console.error('[after-service] pesticide confirmation failed:', e) }

  return NextResponse.json({ ok: true, id: saved.id, finalizedAt: saved.finalized_at, pesticide })
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const { admin, report } = g
  if (report.status !== 'draft') return NextResponse.json({ error: 'A saved report can’t be discarded.' }, { status: 409 })
  const { data, error } = await admin
    .from('after_service_reports')
    .delete()
    .eq('id', report.id)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'No draft to discard' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
