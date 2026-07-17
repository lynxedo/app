import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enrollLeadInStageCampaigns, exitEnrollmentsForLead } from '@/lib/drip'
import { requireCompany } from '@/lib/company-auth'

// TR2 — keys a client must never set via PATCH (identity / provenance / mirror).
const IMMUTABLE = ['id', 'company_id', 'monday_item_id', 'source', 'created_at']

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { companyId, supabase } = auth // reuse the helper's RLS session client

  const { id } = await params
  const body = await request.json()
  const patch = { ...body }
  for (const k of IMMUTABLE) delete patch[k]

  // Stamp stage_changed_at whenever the stage is set (powers card "age in stage"
  // + the stage_changed drip trigger + the reply-auto-move guard).
  const stageChanging = typeof patch.stage === 'string'
  if (stageChanging) patch.stage_changed_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('leads')
    .update(patch)
    .eq('id', id)
    .eq('company_id', companyId) // TR2 — scope to caller's company
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Drip stage-triggers (best-effort; admin client because drip tables are service-role only).
  // Drop into a stage_changed-triggered stage → enroll now (don't wait for the sweep);
  // drop into a Won/Lost-role stage → exit any active drip so we stop nurturing.
  if (stageChanging && data) {
    try {
      const admin = createAdminClient()
      await enrollLeadInStageCampaigns(admin, { companyId, leadId: id, stageKey: patch.stage })
      const { data: st } = await (admin.from('tracker_stages') as any)
        .select('system_role')
        .eq('company_id', companyId)
        .eq('key', patch.stage)
        .maybeSingle()
      if (st?.system_role === 'won' || st?.system_role === 'lost') {
        await exitEnrollmentsForLead(admin, { companyId, leadId: id })
      }
    } catch (err) {
      console.warn('[tracker] drip stage-trigger failed', err)
    }
  }
  return NextResponse.json(data)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { companyId, supabase } = auth // reuse the helper's RLS session client

  const { id } = await params
  const { error } = await supabase
    .from('leads')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId) // TR2 — scope to caller's company

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
