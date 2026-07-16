import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireDripAccess } from '@/lib/drip-auth'
import { safeNormalizeDripSteps, isDripTrigger, type CleanDripStep } from '@/lib/drip-steps'
import { validIdentityId } from '@/lib/email-identities'

const LIST_SELECT = 'id, name, description, trigger_type, trigger_config, status, created_at, updated_at'

// Re-validate each email step's per-step sending identity: keep it only if it's a
// real identity owned by this company, else drop it so the engine falls back to the
// company default (guards against a stale/cross-company id). Mutates in place.
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

// GET — list campaigns + a quick active-enrollment + step count per campaign.
export async function GET() {
  const access = await requireDripAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const admin = createAdminClient()
  const { data: campaigns, error } = await admin
    .from('drip_campaigns')
    .select(LIST_SELECT)
    .eq('company_id', access.companyId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (campaigns ?? []).map((c) => c.id)
  const activeByCampaign: Record<string, number> = {}
  const stepCountByCampaign: Record<string, number> = {}
  const channelsByCampaign: Record<string, Set<string>> = {}
  if (ids.length) {
    const { data: enr } = await admin
      .from('drip_enrollments')
      .select('campaign_id')
      .in('campaign_id', ids)
      .eq('status', 'active')
    for (const r of enr ?? []) activeByCampaign[r.campaign_id] = (activeByCampaign[r.campaign_id] || 0) + 1
    const { data: steps } = await admin.from('drip_steps').select('campaign_id, channel').in('campaign_id', ids)
    for (const r of steps ?? []) {
      stepCountByCampaign[r.campaign_id] = (stepCountByCampaign[r.campaign_id] || 0) + 1
      ;(channelsByCampaign[r.campaign_id] ??= new Set()).add(r.channel)
    }
  }

  const enriched = (campaigns ?? []).map((c) => ({
    ...c,
    active_enrollments: activeByCampaign[c.id] || 0,
    step_count: stepCountByCampaign[c.id] || 0,
    channels: Array.from(channelsByCampaign[c.id] ?? []),
  }))
  return NextResponse.json({ campaigns: enriched })
}

// POST — create a draft campaign (+ optional initial steps).
// body: { name, description?, trigger_type, trigger_config?, steps? }
export async function POST(request: Request) {
  const access = await requireDripAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await request.json().catch(() => ({} as any))
  const name = String(body.name || '').trim()
  const description = String(body.description || '').trim()
  const triggerType = String(body.trigger_type || '')
  const triggerConfig = body.trigger_config && typeof body.trigger_config === 'object' ? body.trigger_config : {}

  if (!name) return NextResponse.json({ error: 'Give the campaign a name.' }, { status: 400 })
  if (!isDripTrigger(triggerType)) return NextResponse.json({ error: 'Pick a valid trigger.' }, { status: 400 })

  const stepsResult = safeNormalizeDripSteps(body.steps ?? [])
  if (!stepsResult.ok) return NextResponse.json({ error: stepsResult.error }, { status: 400 })

  const admin = createAdminClient()
  await sanitizeStepIdentities(admin, access.companyId, stepsResult.steps)
  const { data: campaign, error } = await admin
    .from('drip_campaigns')
    .insert({
      company_id: access.companyId,
      created_by: access.userId,
      name,
      description,
      trigger_type: triggerType,
      trigger_config: triggerConfig,
      status: 'draft',
    })
    .select('id')
    .single()
  if (error || !campaign) return NextResponse.json({ error: error?.message || 'Create failed' }, { status: 500 })

  if (stepsResult.steps.length) {
    const rows = stepsResult.steps.map((s) => ({ campaign_id: campaign.id, ...s }))
    const { error: sErr } = await admin.from('drip_steps').insert(rows)
    if (sErr) {
      await admin.from('drip_campaigns').delete().eq('id', campaign.id)
      return NextResponse.json({ error: sErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ campaign_id: campaign.id })
}
