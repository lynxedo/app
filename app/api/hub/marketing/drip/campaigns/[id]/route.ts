import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireDripAccess } from '@/lib/drip-auth'
import { safeNormalizeDripSteps } from '@/lib/drip-steps'

const DETAIL_SELECT =
  'id, name, description, trigger_type, trigger_config, status, last_swept_at, created_at, updated_at'
const TRIGGERS = ['new_lead', 'lead_source', 'manual']

async function loadOwned(admin: ReturnType<typeof createAdminClient>, companyId: string, id: string) {
  const { data } = await admin
    .from('drip_campaigns')
    .select('id, status, trigger_type, trigger_config')
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  return data
}

// GET — campaign + ordered steps + enrollment counts by status.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await requireDripAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { id } = await ctx.params

  const admin = createAdminClient()
  const { data: campaign } = await admin
    .from('drip_campaigns')
    .select(DETAIL_SELECT)
    .eq('company_id', access.companyId)
    .eq('id', id)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: steps } = await admin
    .from('drip_steps')
    .select('step_index, channel, delay, content_ref')
    .eq('campaign_id', id)
    .order('step_index', { ascending: true })

  const { data: enr } = await admin.from('drip_enrollments').select('status').eq('campaign_id', id)
  const counts: Record<string, number> = { active: 0, replied: 0, completed: 0, opted_out: 0, exited: 0, failed: 0 }
  for (const r of enr ?? []) counts[r.status] = (counts[r.status] || 0) + 1

  return NextResponse.json({ campaign, steps: steps ?? [], enrollment_counts: counts })
}

// PATCH — update name/description/trigger/status and/or replace steps.
// Activating validates the campaign is runnable.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await requireDripAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { id } = await ctx.params

  const admin = createAdminClient()
  const existing = await loadOwned(admin, access.companyId, id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await request.json().catch(() => ({} as any))
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof body.name === 'string') {
    if (!body.name.trim()) return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 })
    update.name = body.name.trim()
  }
  if (typeof body.description === 'string') update.description = body.description.trim()
  if (typeof body.trigger_type === 'string') {
    if (!TRIGGERS.includes(body.trigger_type)) return NextResponse.json({ error: 'Invalid trigger.' }, { status: 400 })
    update.trigger_type = body.trigger_type
  }
  if (body.trigger_config && typeof body.trigger_config === 'object') update.trigger_config = body.trigger_config

  // Replace steps if provided.
  if (body.steps !== undefined) {
    const stepsResult = safeNormalizeDripSteps(body.steps)
    if (!stepsResult.ok) return NextResponse.json({ error: stepsResult.error }, { status: 400 })
    await admin.from('drip_steps').delete().eq('campaign_id', id)
    if (stepsResult.steps.length) {
      const rows = stepsResult.steps.map((s) => ({ campaign_id: id, ...s }))
      const { error: sErr } = await admin.from('drip_steps').insert(rows)
      if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
    }
  }

  // Status transitions.
  if (typeof body.status === 'string') {
    const next = body.status
    if (!['draft', 'active', 'paused'].includes(next)) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
    }
    if (next === 'active') {
      // Runnable checks: at least one step; lead_source triggers need a source;
      // a sender must be configured or the engine HOLDs and nothing sends.
      const { count: stepCount } = await admin
        .from('drip_steps')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', id)
      if (!stepCount) return NextResponse.json({ error: 'Add at least one text step before activating.' }, { status: 400 })

      const triggerType = (update.trigger_type as string) || existing.trigger_type
      const triggerConfig = (update.trigger_config as any) || existing.trigger_config
      if (triggerType === 'lead_source' && !triggerConfig?.lead_source) {
        return NextResponse.json({ error: 'Pick the lead source that triggers this campaign before activating.' }, { status: 400 })
      }

      const { data: settings } = await admin
        .from('drip_settings')
        .select('send_as_user_id')
        .eq('company_id', access.companyId)
        .maybeSingle()
      if (!settings?.send_as_user_id) {
        return NextResponse.json({ error: 'Set who texts are sent as in Drip → Settings before activating.' }, { status: 400 })
      }

      // Seed the sweep watermark so activation doesn't enroll the back-catalog of leads.
      update.last_swept_at = new Date().toISOString()
    }
    update.status = next
  }

  const { error } = await admin.from('drip_campaigns').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE — remove the campaign (cascades steps, enrollments, sends).
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await requireDripAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { id } = await ctx.params

  const admin = createAdminClient()
  const existing = await loadOwned(admin, access.companyId, id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await admin.from('drip_campaigns').delete().eq('id', id)
  return NextResponse.json({ deleted: true })
}
