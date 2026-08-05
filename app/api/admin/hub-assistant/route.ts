// Admin → AI → Assistant settings.
//
// Gated on can_admin_ai (requireAdminArea('ai')), matching the page and the
// sibling AI settings routes. Company-scoped: an admin can only ever read or
// write their OWN company's row.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { allActionMeta, getAssistantSettings } from '@/lib/hub-actions'

const VALID_ACTIONS = new Set(allActionMeta().map((a) => a.name))

export async function GET() {
  const gate = await requireAdminArea('ai')
  // ok=true doesn't narrow company_id/user (both nullable on the result type), and
  // a null company must fail closed rather than fall through unscoped.
  if (!gate.ok || !gate.company_id || !gate.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  const companyId = gate.company_id

  const admin = createAdminClient()
  const settings = await getAssistantSettings(admin, companyId)

  // Connected Claude clients across the company, so an admin can see (and cut)
  // every live connection without hunting through each person's settings.
  const { data: tokenRows } = await admin
    .from('mcp_tokens')
    .select('id, kind, user_id, client_id, label, created_at, last_used_at, expires_at')
    .eq('company_id', companyId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  const rows = (tokenRows || []) as Array<{
    id: string
    kind: string
    user_id: string
    client_id: string | null
    label: string | null
    created_at: string
    last_used_at: string | null
    expires_at: string | null
  }>
  // A refresh token is the durable half of an OAuth connection; access tokens
  // churn hourly, so listing them would show the same connection many times.
  const live = rows.filter((r) => r.kind !== 'access')

  const userIds = [...new Set(live.map((r) => r.user_id))]
  const nameById = new Map<string, string>()
  if (userIds.length) {
    const { data: users } = await admin.from('hub_users').select('id, display_name').in('id', userIds)
    for (const u of (users || []) as Array<{ id: string; display_name: string | null }>) {
      nameById.set(u.id, (u.display_name || 'Someone').trim())
    }
  }
  const clientIds = [...new Set(live.map((r) => r.client_id).filter((c): c is string => Boolean(c)))]
  const clientNameById = new Map<string, string>()
  if (clientIds.length) {
    const { data: clients } = await admin
      .from('mcp_oauth_clients')
      .select('id, client_name')
      .in('id', clientIds)
    for (const c of (clients || []) as Array<{ id: string; client_name: string | null }>) {
      clientNameById.set(c.id, (c.client_name || 'An MCP client').trim())
    }
  }

  return NextResponse.json({
    settings,
    actions: allActionMeta(),
    connections: live.map((r) => ({
      id: r.id,
      user: nameById.get(r.user_id) || 'Someone',
      client: r.client_id ? clientNameById.get(r.client_id) || 'An MCP client' : r.label || 'Access token',
      kind: r.kind === 'personal' ? 'Access token' : 'Claude app',
      created_at: r.created_at,
      last_used_at: r.last_used_at,
    })),
  })
}

export async function PUT(request: Request) {
  const gate = await requireAdminArea('ai')
  // ok=true doesn't narrow company_id/user (both nullable on the result type), and
  // a null company must fail closed rather than fall through unscoped.
  if (!gate.ok || !gate.company_id || !gate.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  const companyId = gate.company_id

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const update: Record<string, unknown> = {
    company_id: companyId,
    updated_at: new Date().toISOString(),
    updated_by: gate.user.id,
  }

  if ('enabled' in body) update.enabled = body.enabled === true
  if ('mcp_enabled' in body) update.mcp_enabled = body.mcp_enabled === true
  if ('require_confirmation' in body) update.require_confirmation = body.require_confirmation === true
  if ('disabled_actions' in body) {
    const raw = Array.isArray(body.disabled_actions) ? body.disabled_actions : []
    // Only known action names — an unknown string here would silently do nothing
    // and look like a working toggle.
    update.disabled_actions = [
      ...new Set(raw.filter((a): a is string => typeof a === 'string' && VALID_ACTIONS.has(a))),
    ]
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('hub_assistant_settings')
    .upsert(update, { onConflict: 'company_id' })
  if (error) {
    return NextResponse.json({ error: 'Could not save settings' }, { status: 500 })
  }

  return NextResponse.json({ settings: await getAssistantSettings(admin, companyId) })
}

/** Revoke one connection (admin-side kill switch), scoped to this company. */
export async function DELETE(request: Request) {
  const gate = await requireAdminArea('ai')
  // ok=true doesn't narrow company_id/user (both nullable on the result type), and
  // a null company must fail closed rather than fall through unscoped.
  if (!gate.ok || !gate.company_id || !gate.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  const companyId = gate.company_id

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('mcp_tokens')
    .select('id, user_id, client_id, company_id, kind')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const t = row as { id: string; user_id: string; client_id: string | null; kind: string }

  const now = new Date().toISOString()
  if (t.kind !== 'personal' && t.client_id) {
    // End the whole OAuth connection, not just its refresh half.
    await admin
      .from('mcp_tokens')
      .update({ revoked_at: now })
      .eq('company_id', companyId)
      .eq('user_id', t.user_id)
      .eq('client_id', t.client_id)
      .is('revoked_at', null)
  } else {
    await admin.from('mcp_tokens').update({ revoked_at: now }).eq('id', t.id).is('revoked_at', null)
  }

  return NextResponse.json({ ok: true })
}
