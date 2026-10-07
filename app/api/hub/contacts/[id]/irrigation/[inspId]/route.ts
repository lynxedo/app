import { NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveIrrigationAccess, contactInCompany } from '@/lib/irrigation-server'
import { suggestForStop } from '@/lib/work-order-suggestions'

// One inspection.
//   PATCH  … /irrigation/:inspId   → autosave the draft (data / sketch / photos)
//   POST   … /irrigation/:inspId   → finalize the draft into a dated snapshot
//   POST   … /irrigation/:inspId { action: 'reopen' } → turn the customer's
//            LATEST finished inspection back into a draft to edit (Ben, Oct 7
//            2026: "I hit Save … I couldn't get back into that inspection. I
//            thought I could edit it"). Only when no other draft is open
//            (one draft per customer); finishing it again re-dates the snapshot.
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
  if (body.action === 'reopen') {
    const { data: latest } = await admin.from('irrigation_inspections')
      .select('id').eq('company_id', access.companyId).eq('contact_id', contactId).eq('status', 'final')
      .order('finalized_at', { ascending: false }).limit(1).maybeSingle()
    if (!latest || latest.id !== inspId) {
      return NextResponse.json({ error: 'Only the most recent inspection can be edited — start a new one instead.' }, { status: 409 })
    }
    const { data: reopened, error: reErr } = await admin.from('irrigation_inspections')
      .update({ status: 'draft', updated_at: new Date().toISOString(), updated_by: access.userId })
      .eq('id', inspId).eq('company_id', access.companyId).eq('contact_id', contactId).eq('status', 'final')
      .select('id').maybeSingle()
    if (reErr) {
      // irrigation_inspections_one_draft_idx: another draft is already open.
      if (reErr.code === '23505') return NextResponse.json({ error: 'This customer already has a draft inspection open — finish or discard it first.' }, { status: 409 })
      return NextResponse.json({ error: reErr.message }, { status: 500 })
    }
    if (!reopened) return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
    return NextResponse.json({ ok: true, id: inspId })
  }
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
    .select('id, finalized_at, inspected_on, stop_id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'No draft to finalize' }, { status: 404 })

  // Work Orders Phase 2: an inspection done from a stop proposes line items on
  // that stop from the office's rules — waiting there when the tech goes back.
  if (data.stop_id) {
    const stopId = data.stop_id as string
    after(async () => {
      try {
        const r = await suggestForStop(admin, access.companyId, stopId, access.userId)
        if (r.added) console.log(`[work-orders] inspection ${inspId} suggested ${r.added} line item(s) on stop ${stopId}`)
      } catch (e) {
        console.error('[work-orders] suggest after finalize failed:', e)
      }
    })
  }
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
