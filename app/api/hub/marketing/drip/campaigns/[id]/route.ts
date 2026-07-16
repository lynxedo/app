import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireDripAccess } from '@/lib/drip-auth'
import { safeNormalizeDripSteps, isDripTrigger, type CleanDripStep } from '@/lib/drip-steps'
import { validIdentityId, resolveSendIdentity } from '@/lib/email-identities'

const DETAIL_SELECT =
  'id, name, description, trigger_type, trigger_config, status, last_swept_at, created_at, updated_at'

// Keep an email step's per-step identity only if it belongs to this company, else
// drop it so the engine falls back to the company default. Mutates in place.
async function sanitizeStepIdentities(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  steps: CleanDripStep[],
): Promise<void> {
  for (const step of steps) {
    const id = step.channel === 'email' ? step.content_ref?.identity_id : null
    if (typeof id !== 'string' || !id) continue
    const valid = await validIdentityId(admin, companyId, id)
    if (valid) step.content_ref.identity_id = valid
    else delete step.content_ref.identity_id
  }
}

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
    if (!isDripTrigger(body.trigger_type)) return NextResponse.json({ error: 'Invalid trigger.' }, { status: 400 })
    update.trigger_type = body.trigger_type
  }
  if (body.trigger_config && typeof body.trigger_config === 'object') update.trigger_config = body.trigger_config

  // Replace steps if provided.
  if (body.steps !== undefined) {
    const stepsResult = safeNormalizeDripSteps(body.steps)
    if (!stepsResult.ok) return NextResponse.json({ error: stepsResult.error }, { status: 400 })
    await sanitizeStepIdentities(admin, access.companyId, stepsResult.steps)
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
      // Runnable checks are CHANNEL-AWARE: only the channels this campaign actually
      // uses need their prerequisites, so an email- or rvm-only campaign isn't
      // blocked by a missing SMS sender (which would otherwise HOLD in the engine).
      const { data: stepRows } = await admin
        .from('drip_steps')
        .select('channel, content_ref')
        .eq('campaign_id', id)
      const steps = stepRows ?? []
      if (!steps.length) return NextResponse.json({ error: 'Add at least one step before activating.' }, { status: 400 })

      const triggerType = (update.trigger_type as string) || existing.trigger_type
      const triggerConfig = (update.trigger_config as any) ?? existing.trigger_config
      if (triggerType === 'lead_source' && !triggerConfig?.lead_source) {
        return NextResponse.json({ error: 'Pick the lead source that triggers this campaign before activating.' }, { status: 400 })
      }
      if (triggerType === 'stage_changed' && !triggerConfig?.stage) {
        return NextResponse.json({ error: 'Pick the stage that triggers this campaign before activating.' }, { status: 400 })
      }

      const { data: settings } = await admin
        .from('drip_settings')
        .select('send_as_user_id, default_email_identity_id, rvm_enabled, rvm_consent_confirmed')
        .eq('company_id', access.companyId)
        .maybeSingle()

      const hasSms = steps.some((s) => s.channel === 'sms')
      const emailSteps = steps.filter((s) => s.channel === 'email')
      const hasRvm = steps.some((s) => s.channel === 'rvm')

      // SMS: drip texts are owned by a Hub user (so replies land in a real inbox).
      if (hasSms && !settings?.send_as_user_id) {
        return NextResponse.json({ error: 'Set who texts are sent as in Drip → Settings before activating.' }, { status: 400 })
      }

      // Email: every email step must resolve a sending identity — its own
      // content_ref.identity_id, else the company default, else a verified domain.
      if (emailSteps.length) {
        const defaultId = (settings as any)?.default_email_identity_id ?? null
        for (const s of emailSteps) {
          const stepId = typeof s.content_ref?.identity_id === 'string' ? s.content_ref.identity_id : null
          const resolved = await resolveSendIdentity(admin, access.companyId, stepId || defaultId)
          if (!resolved) {
            return NextResponse.json(
              { error: 'Set a verified email “Send from” address (or a company default) in Drip → Settings before activating — an email step has no sending domain.' },
              { status: 400 },
            )
          }
        }
      }

      // RVM is legally a call (FCC 22-85): OFF until the company enables it AND
      // confirms it has calling consent for these leads.
      if (hasRvm) {
        const rvmOk = (settings as any)?.rvm_enabled === true && (settings as any)?.rvm_consent_confirmed === true
        if (!rvmOk) {
          return NextResponse.json(
            { error: 'Ringless voicemail is off. Enable it and confirm consent in Drip → Settings before activating.' },
            { status: 400 },
          )
        }
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
