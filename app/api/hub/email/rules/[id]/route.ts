import { NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { RULE_MATCH_MODES, validateRuleActions, validateRuleConditions } from '@/lib/inbox/rules'
import type { InboxRule } from '@/lib/inbox/rules'

export const dynamic = 'force-dynamic'

// Shared Inbox rules — per-rule admin API (same gate as the collection route).
// Every handler verifies the rule belongs to the caller's company before acting.

async function loadOwnedRule(id: string): Promise<
  | { error: NextResponse }
  | { rule: InboxRule; companyId: string; admin: ReturnType<typeof createAdminClient> }
> {
  const check = await requireAdminArea('integrations')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const admin = createAdminClient()
  const { data: rule } = await admin.from('inbox_rules').select('*').eq('id', id).maybeSingle()
  if (!rule || (rule as InboxRule).company_id !== check.company_id) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  return { rule: rule as InboxRule, companyId: check.company_id, admin }
}

// PATCH /api/hub/email/rules/[id] — partial update.
// Accepts: name, enabled, sort_order, match_mode, conditions, actions, stop_processing, account_id.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const loaded = await loadOwnedRule(id)
  if ('error' in loaded) return loaded.error
  const { companyId, admin } = loaded

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'Rule name is required' }, { status: 400 })
    updates.name = name
  }

  if (body.enabled !== undefined) updates.enabled = !!body.enabled
  if (body.stop_processing !== undefined) updates.stop_processing = !!body.stop_processing

  if (body.sort_order !== undefined) {
    if (typeof body.sort_order !== 'number' || !Number.isFinite(body.sort_order)) {
      return NextResponse.json({ error: 'sort_order must be a number' }, { status: 400 })
    }
    updates.sort_order = Math.trunc(body.sort_order)
  }

  if (body.match_mode !== undefined) {
    if (!(RULE_MATCH_MODES as readonly string[]).includes(body.match_mode)) {
      return NextResponse.json(
        { error: `match_mode must be one of: ${RULE_MATCH_MODES.join(', ')}` },
        { status: 400 }
      )
    }
    updates.match_mode = body.match_mode
  }

  if (body.conditions !== undefined) {
    const condCheck = validateRuleConditions(body.conditions)
    if (condCheck.error) return NextResponse.json({ error: condCheck.error }, { status: 400 })
    updates.conditions = condCheck.conditions ?? []
  }

  if (body.actions !== undefined) {
    const actCheck = validateRuleActions(body.actions)
    if (actCheck.error) return NextResponse.json({ error: actCheck.error }, { status: 400 })
    // assign_to_user targets must belong to this company.
    for (const action of actCheck.actions ?? []) {
      if (action.type === 'assign_to_user' && action.user_id) {
        const { data: target } = await admin
          .from('user_profiles')
          .select('company_id')
          .eq('id', action.user_id)
          .maybeSingle()
        if (!target || target.company_id !== companyId) {
          return NextResponse.json({ error: 'Assign target is not a member of this company' }, { status: 400 })
        }
      }
    }
    updates.actions = actCheck.actions ?? []
  }

  if (body.account_id !== undefined) {
    if (body.account_id === null) {
      updates.account_id = null
    } else {
      const { data: acct } = await admin
        .from('inbox_accounts')
        .select('id, company_id')
        .eq('id', body.account_id)
        .maybeSingle()
      if (!acct || acct.company_id !== companyId) {
        return NextResponse.json({ error: 'Invalid account_id' }, { status: 400 })
      }
      updates.account_id = acct.id
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }
  updates.updated_at = new Date().toISOString()

  const { data: updated, error } = await admin
    .from('inbox_rules')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()
  if (error || !updated) {
    return NextResponse.json({ error: error?.message || 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ rule: updated as InboxRule })
}

// DELETE /api/hub/email/rules/[id]
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const loaded = await loadOwnedRule(id)
  if ('error' in loaded) return loaded.error
  const { admin } = loaded

  const { error } = await admin.from('inbox_rules').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
