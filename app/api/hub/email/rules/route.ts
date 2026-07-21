import { NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  MAX_RULES_PER_COMPANY,
  RULE_MATCH_MODES,
  validateRuleActions,
  validateRuleConditions,
} from '@/lib/inbox/rules'
import type { InboxRule } from '@/lib/inbox/rules'

export const dynamic = 'force-dynamic'

// Shared Inbox rules — admin CRUD. Gated on the same area as connecting the
// mailbox itself (Admin → Integrations). inbox_rules is service-role-only, so
// all reads/writes go through the admin client after the gate.

// GET /api/hub/email/rules — list this company's rules, ordered.
export async function GET() {
  const check = await requireAdminArea('integrations')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('inbox_rules')
    .select('*')
    .eq('company_id', check.company_id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ rules: (data ?? []) as InboxRule[] })
}

// POST /api/hub/email/rules — create a rule.
// Body: { name, match_mode?, conditions, actions, stop_processing?, enabled?, account_id? }
// Unknown condition fields/ops and unknown action types are rejected HERE so bad
// data can never enter the table (the engine additionally skips unknowns for
// rows written by a future app version).
export async function POST(request: Request) {
  const check = await requireAdminArea('integrations')
  if (!check.ok || !check.company_id || !check.user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const companyId = check.company_id

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Rule name is required' }, { status: 400 })

  const matchMode = body.match_mode === undefined ? 'all' : body.match_mode
  if (!(RULE_MATCH_MODES as readonly string[]).includes(matchMode)) {
    return NextResponse.json(
      { error: `match_mode must be one of: ${RULE_MATCH_MODES.join(', ')}` },
      { status: 400 }
    )
  }

  const condCheck = validateRuleConditions(body.conditions ?? [])
  if (condCheck.error) return NextResponse.json({ error: condCheck.error }, { status: 400 })
  const actCheck = validateRuleActions(body.actions ?? [])
  if (actCheck.error) return NextResponse.json({ error: actCheck.error }, { status: 400 })

  const admin = createAdminClient()

  // Cap rules per company.
  const { count } = await admin
    .from('inbox_rules')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
  if ((count ?? 0) >= MAX_RULES_PER_COMPANY) {
    return NextResponse.json(
      { error: `Rule limit reached (${MAX_RULES_PER_COMPANY} per company)` },
      { status: 400 }
    )
  }

  // assign_to_user targets must belong to this company (mirrors the assign route's guard).
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

  // Optional mailbox scope — must be one of this company's accounts.
  let accountId: string | null = null
  if (body.account_id) {
    const { data: acct } = await admin
      .from('inbox_accounts')
      .select('id, company_id')
      .eq('id', body.account_id)
      .maybeSingle()
    if (!acct || acct.company_id !== companyId) {
      return NextResponse.json({ error: 'Invalid account_id' }, { status: 400 })
    }
    accountId = acct.id as string
  }

  // New rules append to the end of the run order by default.
  let sortOrder: number
  if (typeof body.sort_order === 'number' && Number.isFinite(body.sort_order)) {
    sortOrder = Math.trunc(body.sort_order)
  } else {
    const { data: last } = await admin
      .from('inbox_rules')
      .select('sort_order')
      .eq('company_id', companyId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    sortOrder = ((last?.sort_order as number | undefined) ?? -1) + 1
  }

  const { data: created, error } = await admin
    .from('inbox_rules')
    .insert({
      company_id: companyId,
      account_id: accountId,
      name,
      enabled: body.enabled === undefined ? true : !!body.enabled,
      sort_order: sortOrder,
      match_mode: matchMode,
      conditions: condCheck.conditions ?? [],
      actions: actCheck.actions ?? [],
      stop_processing: !!body.stop_processing,
      created_by: check.user.id,
    })
    .select('*')
    .single()
  if (error || !created) {
    return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json({ rule: created as InboxRule })
}
