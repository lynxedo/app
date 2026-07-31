import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveIrrigationAccess, contactInCompany } from '@/lib/irrigation-server'

// One inspection.
//   PATCH  … /irrigation/:inspId   → autosave the draft (data / sketch / photos)
//   POST   … /irrigation/:inspId   → finalize the draft into a dated snapshot
//   DELETE … /irrigation/:inspId   → discard the draft
// All require can_access_irrigation (admins always) and act only on a `draft`.

type Ctx = { params: Promise<{ id: string; inspId: string }> }

async function gate(ctx: Ctx) {
  const { id: contactId, inspId } = await ctx.params
  const access = await resolveIrrigationAccess()
  if ('error' in access) return { error: access.error }
  if (!access.canEdit) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const admin = createAdminClient()
  if (!(await contactInCompany(admin, contactId, access.companyId))) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  return { access, admin, contactId, inspId }
}

export async function PATCH(request: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const { access, admin, contactId, inspId } = g

  const body = await request.json().catch(() => ({}))
  const update: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: access.userId }
  if (body.data && typeof body.data === 'object') update.data = body.data
  if ('sketch_key' in body) update.sketch_key = body.sketch_key ? String(body.sketch_key) : null
  if (Array.isArray(body.photo_keys)) update.photo_keys = body.photo_keys.filter((k: unknown) => typeof k === 'string')

  const { data, error } = await admin
    .from('irrigation_inspections')
    .update(update)
    .eq('id', inspId)
    .eq('company_id', access.companyId)
    .eq('contact_id', contactId)
    .eq('status', 'draft') // a finalized snapshot is immutable
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'No editable draft found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function POST(request: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const { access, admin, contactId, inspId } = g

  const body = await request.json().catch(() => ({}))
  const now = new Date()
  const inspectedOn =
    typeof body.inspected_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.inspected_on)
      ? body.inspected_on
      : now.toISOString().slice(0, 10)

  // Optional last-write of the form before finalizing.
  const update: Record<string, unknown> = {
    status: 'final',
    finalized_at: now.toISOString(),
    inspected_on: inspectedOn,
    updated_at: now.toISOString(),
    updated_by: access.userId,
  }
  if (body.data && typeof body.data === 'object') update.data = body.data
  if ('sketch_key' in body) update.sketch_key = body.sketch_key ? String(body.sketch_key) : null
  if (Array.isArray(body.photo_keys)) update.photo_keys = body.photo_keys.filter((k: unknown) => typeof k === 'string')

  const { data, error } = await admin
    .from('irrigation_inspections')
    .update(update)
    .eq('id', inspId)
    .eq('company_id', access.companyId)
    .eq('contact_id', contactId)
    .eq('status', 'draft')
    .select('id, finalized_at, inspected_on')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'No draft to finalize' }, { status: 404 })
  return NextResponse.json({ ok: true, id: data.id, finalizedAt: data.finalized_at, inspectedOn: data.inspected_on })
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const { access, admin, contactId, inspId } = g

  const { data, error } = await admin
    .from('irrigation_inspections')
    .delete()
    .eq('id', inspId)
    .eq('company_id', access.companyId)
    .eq('contact_id', contactId)
    .eq('status', 'draft') // never delete a finalized snapshot
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'No draft to discard' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
