import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function authResolve(stopId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return { error: 'Profile not found', status: 404 as const }

  const admin = createAdminClient()
  const { data: stop } = await admin
    .from('daily_log_stops')
    .select('id, client_name, client_phone, daily_log_entries!inner(company_id)')
    .eq('id', stopId)
    .single()
  if (!stop) return { error: 'Stop not found', status: 404 as const }

  const entry = Array.isArray(stop.daily_log_entries)
    ? stop.daily_log_entries[0]
    : stop.daily_log_entries
  if (!entry || entry.company_id !== profile.company_id) {
    return { error: 'Stop not found', status: 404 as const }
  }
  return { admin, stop, userId: user.id, companyId: profile.company_id }
}

// GET — return the report for this stop (null if none yet).
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const resolved = await authResolve(id)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { admin } = resolved

  const { data: report, error } = await admin
    .from('daily_log_stop_reports')
    .select('id, main_service, additional_services, issues_found, notes, sent_at, created_at, updated_at')
    .eq('stop_id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ report: report ?? null })
}

type ReportBody = {
  main_service?: unknown
  additional_services?: unknown
  issues_found?: unknown
  notes?: unknown
}

function parseReportBody(body: ReportBody) {
  return {
    main_service: typeof body.main_service === 'string' ? body.main_service.trim().slice(0, 200) || null : null,
    additional_services: Array.isArray(body.additional_services)
      ? (body.additional_services as unknown[]).filter(s => typeof s === 'string').map(s => (s as string).trim()).filter(Boolean).slice(0, 20)
      : [],
    issues_found: Array.isArray(body.issues_found)
      ? (body.issues_found as unknown[]).filter(s => typeof s === 'string').map(s => (s as string).trim()).filter(Boolean).slice(0, 20)
      : [],
    notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null,
  }
}

// POST — create the report (upsert: if one already exists, update it).
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const resolved = await authResolve(id)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { admin, companyId } = resolved

  const body = await request.json().catch(() => ({})) as ReportBody
  const fields = parseReportBody(body)

  // Upsert: the table has a UNIQUE constraint on stop_id.
  const { data: report, error } = await admin
    .from('daily_log_stop_reports')
    .upsert(
      { stop_id: id, company_id: companyId, ...fields, updated_at: new Date().toISOString() },
      { onConflict: 'stop_id' },
    )
    .select('id, main_service, additional_services, issues_found, notes, sent_at, created_at, updated_at')
    .single()

  if (error || !report) {
    return NextResponse.json({ error: error?.message ?? 'Upsert failed' }, { status: 500 })
  }
  return NextResponse.json({ report })
}

// PATCH — update individual fields of an existing report.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const resolved = await authResolve(id)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { admin } = resolved

  const body = await request.json().catch(() => ({})) as ReportBody
  const fields = parseReportBody(body)
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('main_service' in body) updates.main_service = fields.main_service
  if ('additional_services' in body) updates.additional_services = fields.additional_services
  if ('issues_found' in body) updates.issues_found = fields.issues_found
  if ('notes' in body) updates.notes = fields.notes

  const { data: report, error } = await admin
    .from('daily_log_stop_reports')
    .update(updates)
    .eq('stop_id', id)
    .select('id, main_service, additional_services, issues_found, notes, sent_at, created_at, updated_at')
    .single()

  if (error || !report) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }
  return NextResponse.json({ report })
}
