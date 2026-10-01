import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { r2SignedUrl } from '@/lib/r2'
import type { IrrigationData } from '@/lib/irrigation'
import { resolveIrrigationAccess, contactInCompany } from '@/lib/irrigation-server'

// Irrigation inspections for a customer.
//   GET  /api/hub/contacts/:id/irrigation            → draft + latest final + history
//   GET  /api/hub/contacts/:id/irrigation?inspId=…   → one specific inspection (full)
//   POST /api/hub/contacts/:id/irrigation            → start (or resume) a draft
//        body (optional): { stopId?, jobberVisitId? } — Work Orders Phase 1: when
//        the tech starts the inspection from a stop on their Work Order list, the
//        draft is tied to that stop + Jobber visit so the stop can show
//        Start / Continue / View and the inspection can link back to its day.
//
// Viewing rides on can_access_hub (page gate); creating/editing requires
// can_access_irrigation (admins always). All writes go through the admin client.

type InspRow = {
  id: string; status: string; data: IrrigationData; sketch_key: string | null
  photo_keys: string[] | null; inspected_on: string | null; finalized_at: string | null
  share_token: string | null; share_expires_at: string | null; created_by: string | null; updated_at: string
  stop_id: string | null; jobber_visit_id: string | null
}

// "From work order · Oct 1 · Josh" — resolved for every inspection that has a
// stop. Keyed by stop id; the stop's day + tech come from its entry.
type WorkOrderRef = { stopId: string; date: string; tech: string | null; status: string }

async function toFull(row: InspRow, nameById: Map<string, string>, workOrders?: Map<string, WorkOrderRef>) {
  const sketchUrl = row.sketch_key ? await r2SignedUrl(row.sketch_key, 3600).catch(() => null) : null
  const photoUrls = await Promise.all(
    (row.photo_keys ?? []).map(k => r2SignedUrl(k, 3600).catch(() => null)),
  )
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
  const shareActive = !!row.share_token && (!row.share_expires_at || new Date(row.share_expires_at) > new Date())
  return {
    id: row.id,
    status: row.status,
    data: row.data ?? {},
    sketchUrl,
    photoKeys: row.photo_keys ?? [],
    photoUrls: photoUrls.filter(Boolean) as string[],
    inspectedOn: row.inspected_on,
    finalizedAt: row.finalized_at,
    by: row.created_by ? (nameById.get(row.created_by) ?? null) : null,
    shareUrl: shareActive ? `${baseUrl}/irrigation/${row.share_token}` : null,
    shareExpiresAt: shareActive ? row.share_expires_at : null,
    stopId: row.stop_id ?? null,
    jobberVisitId: row.jobber_visit_id ?? null,
    workOrder: row.stop_id ? (workOrders?.get(row.stop_id) ?? null) : null,
  }
}

const COLS = 'id, status, data, sketch_key, photo_keys, inspected_on, finalized_at, share_token, share_expires_at, created_by, updated_at, stop_id, jobber_visit_id'

/** Resolve stop → (day, tech, status) for the inspections that were done from a work order. */
async function workOrdersFor(admin: ReturnType<typeof createAdminClient>, stopIds: (string | null)[]) {
  const uniq = Array.from(new Set(stopIds.filter((x): x is string => !!x)))
  const map = new Map<string, WorkOrderRef>()
  if (uniq.length === 0) return map
  const { data } = await admin
    .from('daily_log_stops')
    .select('id, status, entry:daily_log_entries!entry_id(log_date, tech:hub_users!tech_user_id(display_name))')
    .in('id', uniq)
  for (const row of (data ?? []) as unknown as { id: string; status: string; entry: { log_date: string; tech: { display_name: string } | null } | null }[]) {
    if (!row.entry) continue
    map.set(row.id, { stopId: row.id, date: row.entry.log_date, tech: row.entry.tech?.display_name ?? null, status: row.status })
  }
  return map
}

async function namesFor(admin: ReturnType<typeof createAdminClient>, ids: (string | null)[]) {
  const uniq = Array.from(new Set(ids.filter((x): x is string => !!x)))
  const map = new Map<string, string>()
  if (uniq.length === 0) return map
  const { data } = await admin.from('hub_users').select('id, display_name').in('id', uniq)
  for (const u of data ?? []) map.set(u.id as string, (u.display_name as string) || '')
  return map
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: contactId } = await params
  const access = await resolveIrrigationAccess()
  if ('error' in access) return access.error
  const admin = createAdminClient()
  if (!(await contactInCompany(admin, contactId, access.companyId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const inspId = url.searchParams.get('inspId')

  if (inspId) {
    const { data: row } = await admin
      .from('irrigation_inspections')
      .select(COLS)
      .eq('id', inspId)
      .eq('company_id', access.companyId)
      .eq('contact_id', contactId)
      .maybeSingle()
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const names = await namesFor(admin, [(row as InspRow).created_by])
    const wos = await workOrdersFor(admin, [(row as InspRow).stop_id])
    return NextResponse.json({ canEdit: access.canEdit, inspection: await toFull(row as InspRow, names, wos) })
  }

  const { data: rows } = await admin
    .from('irrigation_inspections')
    .select(COLS)
    .eq('company_id', access.companyId)
    .eq('contact_id', contactId)
    .order('finalized_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })

  const all = (rows ?? []) as InspRow[]
  const draftRow = all.find(r => r.status === 'draft') ?? null
  const finals = all.filter(r => r.status === 'final')
  const names = await namesFor(admin, all.map(r => r.created_by))
  const wos = await workOrdersFor(admin, all.map(r => r.stop_id))

  const draft = draftRow ? await toFull(draftRow, names, wos) : null
  const latest = finals[0] ? await toFull(finals[0], names, wos) : null
  const history = finals.map(r => ({
    id: r.id,
    finalizedAt: r.finalized_at,
    inspectedOn: r.inspected_on,
    by: r.created_by ? (names.get(r.created_by) ?? null) : null,
    zoneCount: Array.isArray(r.data?.zones) ? r.data.zones.length : 0,
    workOrder: r.stop_id ? (wos.get(r.stop_id) ?? null) : null,
  }))

  return NextResponse.json({ canEdit: access.canEdit, draft, latest, history })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: contactId } = await params
  const access = await resolveIrrigationAccess()
  if ('error' in access) return access.error
  if (!access.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  if (!(await contactInCompany(admin, contactId, access.companyId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Optional work-order context (body may be absent — the customer-file card
  // posts nothing). The stop must exist in this company; it is tied to this
  // contact unless the stop has no customer file yet (then we trust the tech,
  // who tapped Inspection on that very stop). The Jobber visit id is read from
  // the stop itself so a stale client value can't mislink.
  let stopLink: { stop_id: string; jobber_visit_id: string | null } | null = null
  try {
    const body = await request.json().catch(() => null) as { stopId?: unknown; jobberVisitId?: unknown } | null
    const stopId = typeof body?.stopId === 'string' ? body.stopId : null
    if (stopId) {
      const { data: stop } = await admin
        .from('daily_log_stops')
        .select('id, jobber_visit_id, contact_id, entry:daily_log_entries!entry_id(company_id)')
        .eq('id', stopId)
        .maybeSingle()
      const row = stop as unknown as { id: string; jobber_visit_id: string | null; contact_id: string | null; entry: { company_id: string } | null } | null
      if (!row || row.entry?.company_id !== access.companyId) {
        return NextResponse.json({ error: 'That work order was not found.' }, { status: 404 })
      }
      if (row.contact_id && row.contact_id !== contactId) {
        return NextResponse.json({ error: 'That work order belongs to a different customer.' }, { status: 409 })
      }
      stopLink = { stop_id: row.id, jobber_visit_id: row.jobber_visit_id ?? null }
    }
  } catch { /* no body — fine */ }

  // Resume an existing open draft if there is one. When the tech is resuming
  // from a stop, re-point the draft at THIS stop/visit: a draft is the one
  // working copy for the customer and the visit it is being done on is the one
  // in front of the tech right now (an abandoned draft from an earlier visit
  // would otherwise keep that stop forever).
  const { data: existingDraft } = await admin
    .from('irrigation_inspections')
    .select(COLS)
    .eq('company_id', access.companyId)
    .eq('contact_id', contactId)
    .eq('status', 'draft')
    .maybeSingle()
  if (existingDraft) {
    let draftRow = existingDraft as InspRow
    if (stopLink && (draftRow.stop_id !== stopLink.stop_id || draftRow.jobber_visit_id !== stopLink.jobber_visit_id)) {
      const { data: relinked } = await admin
        .from('irrigation_inspections')
        .update({ stop_id: stopLink.stop_id, jobber_visit_id: stopLink.jobber_visit_id, updated_by: access.userId })
        .eq('id', draftRow.id)
        .select(COLS)
        .maybeSingle()
      if (relinked) draftRow = relinked as InspRow
    }
    const names = await namesFor(admin, [draftRow.created_by])
    const wos = await workOrdersFor(admin, [draftRow.stop_id])
    return NextResponse.json({ inspection: await toFull(draftRow, names, wos), resumed: true })
  }

  // Otherwise start a new draft, pre-filled from the most recent completed
  // inspection (so a repeat visit tweaks what changed, not re-enters everything).
  const { data: latestFinal } = await admin
    .from('irrigation_inspections')
    .select('data, property_id')
    .eq('company_id', access.companyId)
    .eq('contact_id', contactId)
    .eq('status', 'final')
    .order('finalized_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  // Pre-fill the field data from the last visit (the big time-saver); the sketch
  // + photos start fresh each visit (the prior map stays visible in history).
  const { data: created, error } = await admin
    .from('irrigation_inspections')
    .insert({
      company_id: access.companyId,
      contact_id: contactId,
      property_id: latestFinal?.property_id ?? null,
      status: 'draft',
      data: latestFinal?.data ?? {},
      created_by: access.userId,
      updated_by: access.userId,
      stop_id: stopLink?.stop_id ?? null,
      jobber_visit_id: stopLink?.jobber_visit_id ?? null,
    })
    .select(COLS)
    .single()
  if (error || !created) return NextResponse.json({ error: error?.message || 'Create failed' }, { status: 500 })

  const names = await namesFor(admin, [(created as InspRow).created_by])
  const wos = await workOrdersFor(admin, [(created as InspRow).stop_id])
  return NextResponse.json({ inspection: await toFull(created as InspRow, names, wos), prefilled: !!latestFinal })
}
