import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireDripAccess } from '@/lib/drip-auth'
import { safeNormalizeDripSteps } from '@/lib/drip-steps'

const TRIGGERS = new Set(['new_lead', 'lead_source', 'manual'])
const LIST_SELECT = 'id, name, description, trigger_type, trigger_config, status, created_at, updated_at'

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
  if (ids.length) {
    const { data: enr } = await admin
      .from('drip_enrollments')
      .select('campaign_id')
      .in('campaign_id', ids)
      .eq('status', 'active')
    for (const r of enr ?? []) activeByCampaign[r.campaign_id] = (activeByCampaign[r.campaign_id] || 0) + 1
    const { data: steps } = await admin.from('drip_steps').select('campaign_id').in('campaign_id', ids)
    for (const r of steps ?? []) stepCountByCampaign[r.campaign_id] = (stepCountByCampaign[r.campaign_id] || 0) + 1
  }

  const enriched = (campaigns ?? []).map((c) => ({
    ...c,
    active_enrollments: activeByCampaign[c.id] || 0,
    step_count: stepCountByCampaign[c.id] || 0,
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
  if (!TRIGGERS.has(triggerType)) return NextResponse.json({ error: 'Pick a valid trigger.' }, { status: 400 })

  const stepsResult = safeNormalizeDripSteps(body.steps ?? [])
  if (!stepsResult.ok) return NextResponse.json({ error: stepsResult.error }, { status: 400 })

  const admin = createAdminClient()
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
