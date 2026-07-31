import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { r2SignedUrl } from '@/lib/r2'
import type { IrrigationData } from '@/lib/irrigation'
import { resolveIrrigationAccess, contactInCompany } from '@/lib/irrigation-server'

// Irrigation inspections for a customer.
//   GET  /api/hub/contacts/:id/irrigation            → draft + latest final + history
//   GET  /api/hub/contacts/:id/irrigation?inspId=…   → one specific inspection (full)
//   POST /api/hub/contacts/:id/irrigation            → start (or resume) a draft
//
// Viewing rides on can_access_hub (page gate); creating/editing requires
// can_access_irrigation (admins always). All writes go through the admin client.

type InspRow = {
  id: string; status: string; data: IrrigationData; sketch_key: string | null
  photo_keys: string[] | null; inspected_on: string | null; finalized_at: string | null
  share_token: string | null; share_expires_at: string | null; created_by: string | null; updated_at: string
}

async function toFull(row: InspRow, nameById: Map<string, string>) {
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
  }
}

const COLS = 'id, status, data, sketch_key, photo_keys, inspected_on, finalized_at, share_token, share_expires_at, created_by, updated_at'

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
    return NextResponse.json({ canEdit: access.canEdit, inspection: await toFull(row as InspRow, names) })
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

  const draft = draftRow ? await toFull(draftRow, names) : null
  const latest = finals[0] ? await toFull(finals[0], names) : null
  const history = finals.map(r => ({
    id: r.id,
    finalizedAt: r.finalized_at,
    inspectedOn: r.inspected_on,
    by: r.created_by ? (names.get(r.created_by) ?? null) : null,
    zoneCount: Array.isArray(r.data?.zones) ? r.data.zones.length : 0,
  }))

  return NextResponse.json({ canEdit: access.canEdit, draft, latest, history })
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: contactId } = await params
  const access = await resolveIrrigationAccess()
  if ('error' in access) return access.error
  if (!access.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  if (!(await contactInCompany(admin, contactId, access.companyId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Resume an existing open draft if there is one.
  const { data: existingDraft } = await admin
    .from('irrigation_inspections')
    .select(COLS)
    .eq('company_id', access.companyId)
    .eq('contact_id', contactId)
    .eq('status', 'draft')
    .maybeSingle()
  if (existingDraft) {
    const names = await namesFor(admin, [(existingDraft as InspRow).created_by])
    return NextResponse.json({ inspection: await toFull(existingDraft as InspRow, names), resumed: true })
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
    })
    .select(COLS)
    .single()
  if (error || !created) return NextResponse.json({ error: error?.message || 'Create failed' }, { status: 500 })

  const names = await namesFor(admin, [(created as InspRow).created_by])
  return NextResponse.json({ inspection: await toFull(created as InspRow, names), prefilled: !!latestFinal })
}
