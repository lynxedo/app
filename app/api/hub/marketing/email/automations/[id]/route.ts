import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'
import { safeNormalizeSteps } from '@/lib/email-automation-steps'
import { validIdentityId } from '@/lib/email-identities'

const DETAIL_SELECT =
  'id, name, description, trigger_type, trigger_config, status, identity_id, last_swept_at, created_at, updated_at'

async function loadOwned(admin: ReturnType<typeof createAdminClient>, companyId: string, id: string) {
  const { data } = await admin
    .from('email_automations')
    .select('id, status, trigger_type, trigger_config')
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  return data
}

// GET — automation + ordered steps + enrollment counts by status.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { id } = await ctx.params

  const admin = createAdminClient()
  const { data: automation } = await admin
    .from('email_automations')
    .select(DETAIL_SELECT)
    .eq('company_id', access.companyId)
    .eq('id', id)
    .maybeSingle()
  if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: steps } = await admin
    .from('email_automation_steps')
    .select('step_index, type, config')
    .eq('automation_id', id)
    .order('step_index', { ascending: true })

  const { data: enr } = await admin
    .from('email_automation_enrollments')
    .select('status')
    .eq('automation_id', id)
  const counts: Record<string, number> = { active: 0, completed: 0, exited: 0, paused: 0 }
  for (const r of enr ?? []) counts[r.status] = (counts[r.status] || 0) + 1

  return NextResponse.json({ automation, steps: steps ?? [], enrollment_counts: counts })
}

// PATCH — update name/description/trigger/status and/or replace steps.
// Activating validates the journey is runnable.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await requireEmailAccess()
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
  if ('identity_id' in body) update.identity_id = await validIdentityId(admin, access.companyId, typeof body.identity_id === 'string' ? body.identity_id : null)
  if (typeof body.trigger_type === 'string') {
    if (!['new_client', 'tag_added', 'manual'].includes(body.trigger_type)) {
      return NextResponse.json({ error: 'Invalid trigger.' }, { status: 400 })
    }
    update.trigger_type = body.trigger_type
  }
  if (body.trigger_config && typeof body.trigger_config === 'object') update.trigger_config = body.trigger_config

  // Replace steps if provided.
  if (body.steps !== undefined) {
    const stepsResult = safeNormalizeSteps(body.steps)
    if (!stepsResult.ok) return NextResponse.json({ error: stepsResult.error }, { status: 400 })
    await admin.from('email_automation_steps').delete().eq('automation_id', id)
    if (stepsResult.steps.length) {
      const rows = stepsResult.steps.map((s) => ({ automation_id: id, ...s }))
      const { error: sErr } = await admin.from('email_automation_steps').insert(rows)
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
      // Validate runnable: at least one step, and tag triggers need a tag.
      const { count: stepCount } = await admin
        .from('email_automation_steps')
        .select('id', { count: 'exact', head: true })
        .eq('automation_id', id)
      if (!stepCount) return NextResponse.json({ error: 'Add at least one step before activating.' }, { status: 400 })
      const triggerType = (update.trigger_type as string) || existing.trigger_type
      const triggerConfig = (update.trigger_config as any) || existing.trigger_config
      if (triggerType === 'tag_added' && !triggerConfig?.tag_id) {
        return NextResponse.json({ error: 'Pick the tag that triggers this automation before activating.' }, { status: 400 })
      }
      // Seed the sweep watermark so a new_client automation doesn't backfill the
      // entire existing customer list on activation.
      update.last_swept_at = new Date().toISOString()
    }
    update.status = next
  }

  const { error } = await admin.from('email_automations').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE — remove the automation (cascades steps, enrollments, sends).
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { id } = await ctx.params

  const admin = createAdminClient()
  const existing = await loadOwned(admin, access.companyId, id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await admin.from('email_automations').delete().eq('id', id)
  return NextResponse.json({ deleted: true })
}
