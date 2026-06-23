import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'
import { safeNormalizeSteps } from '@/lib/email-automation-steps'

const TRIGGERS = new Set(['new_client', 'tag_added', 'manual'])
const LIST_SELECT = 'id, name, description, trigger_type, trigger_config, status, created_at, updated_at'

// GET — list automations + a quick active-enrollment count per automation.
export async function GET() {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const admin = createAdminClient()
  const { data: automations, error } = await admin
    .from('email_automations')
    .select(LIST_SELECT)
    .eq('company_id', access.companyId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (automations ?? []).map((a) => a.id)
  const activeByAutomation: Record<string, number> = {}
  const stepCountByAutomation: Record<string, number> = {}
  if (ids.length) {
    const { data: enr } = await admin
      .from('email_automation_enrollments')
      .select('automation_id')
      .in('automation_id', ids)
      .eq('status', 'active')
    for (const r of enr ?? []) activeByAutomation[r.automation_id] = (activeByAutomation[r.automation_id] || 0) + 1
    const { data: steps } = await admin
      .from('email_automation_steps')
      .select('automation_id')
      .in('automation_id', ids)
    for (const r of steps ?? []) stepCountByAutomation[r.automation_id] = (stepCountByAutomation[r.automation_id] || 0) + 1
  }

  const enriched = (automations ?? []).map((a) => ({
    ...a,
    active_enrollments: activeByAutomation[a.id] || 0,
    step_count: stepCountByAutomation[a.id] || 0,
  }))
  return NextResponse.json({ automations: enriched })
}

// POST — create a draft automation (+ optional initial steps).
// body: { name, description?, trigger_type, trigger_config?, steps? }
export async function POST(request: Request) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await request.json().catch(() => ({} as any))
  const name = String(body.name || '').trim()
  const description = String(body.description || '').trim()
  const triggerType = String(body.trigger_type || '')
  const triggerConfig = body.trigger_config && typeof body.trigger_config === 'object' ? body.trigger_config : {}

  if (!name) return NextResponse.json({ error: 'Give the automation a name.' }, { status: 400 })
  if (!TRIGGERS.has(triggerType)) return NextResponse.json({ error: 'Pick a valid trigger.' }, { status: 400 })

  const stepsResult = safeNormalizeSteps(body.steps ?? [])
  if (!stepsResult.ok) return NextResponse.json({ error: stepsResult.error }, { status: 400 })

  const admin = createAdminClient()
  const { data: automation, error } = await admin
    .from('email_automations')
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
  if (error || !automation) return NextResponse.json({ error: error?.message || 'Create failed' }, { status: 500 })

  if (stepsResult.steps.length) {
    const rows = stepsResult.steps.map((s) => ({ automation_id: automation.id, ...s }))
    const { error: sErr } = await admin.from('email_automation_steps').insert(rows)
    if (sErr) {
      await admin.from('email_automations').delete().eq('id', automation.id)
      return NextResponse.json({ error: sErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ automation_id: automation.id })
}
