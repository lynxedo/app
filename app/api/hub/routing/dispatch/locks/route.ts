import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'

// Locked time frames (= PROMISED stops, Ben Oct 19 2026). Jobber's visit edit
// takes only a start and end, so the customer's window lives here. Office sets
// them in Dispatch; Amber will set them when she books a window (Phase 3).
// Techs see a lock on their Work Order stop but never change it.

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/

export async function POST(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const { companyId, userId } = auth

  const b = await request.json().catch(() => null) as {
    jobberItemId?: string; kind?: string; windowStart?: string; windowEnd?: string; note?: string | null
  } | null
  if (!b?.jobberItemId) return NextResponse.json({ error: 'jobberItemId is required' }, { status: 400 })
  if (!['visit', 'assessment', 'task'].includes(b.kind ?? '')) return NextResponse.json({ error: 'kind is invalid' }, { status: 400 })
  if (!b.windowStart || !b.windowEnd || !ISO_RE.test(b.windowStart) || !ISO_RE.test(b.windowEnd))
    return NextResponse.json({ error: 'windowStart and windowEnd must be ISO times' }, { status: 400 })
  if (new Date(b.windowEnd) <= new Date(b.windowStart))
    return NextResponse.json({ error: 'The window has to end after it starts' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.from('dispatch_visit_locks').upsert({
    company_id: companyId,
    jobber_item_id: b.jobberItemId,
    item_kind: b.kind,
    window_start: b.windowStart,
    window_end: b.windowEnd,
    locked_by: userId,
    locked_source: 'office',
    note: b.note?.toString().slice(0, 300) || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'company_id,jobber_item_id' })
    .select('jobber_item_id, item_kind, window_start, window_end, locked_source, note')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ lock: data })
}

export async function DELETE(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const admin = createAdminClient()
  const { error } = await admin.from('dispatch_visit_locks').delete()
    .eq('company_id', auth.companyId).eq('jobber_item_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
