// Per-user personal access tokens for the Hub MCP endpoint.
//
// These are what a user pastes into Claude Code / cowork when they'd rather not
// run the OAuth flow. Cookie-session authenticated (this is a Hub UI surface, not
// a machine endpoint) and always scoped to the caller's own tokens — a user can
// never see or revoke someone else's.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCompany } from '@/lib/company-auth'
import { canonicalResource, mintMcpToken } from '@/lib/mcp-auth'
import { getAssistantSettings } from '@/lib/hub-actions'

const MAX_TOKENS_PER_USER = 10

export async function GET() {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error

  const admin = createAdminClient()
  const settings = await getAssistantSettings(admin, auth.companyId)

  const { data } = await admin
    .from('mcp_tokens')
    .select('id, kind, token_prefix, label, client_id, created_at, last_used_at')
    .eq('user_id', auth.userId)
    .eq('company_id', auth.companyId)
    .is('revoked_at', null)
    .neq('kind', 'access')
    .order('created_at', { ascending: false })
    .limit(50)

  const rows = (data || []) as Array<{
    id: string
    kind: string
    token_prefix: string | null
    label: string | null
    client_id: string | null
    created_at: string
    last_used_at: string | null
  }>

  const clientIds = [...new Set(rows.map((r) => r.client_id).filter((c): c is string => Boolean(c)))]
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
    mcp_url: canonicalResource(),
    enabled: settings.enabled && settings.mcpEnabled,
    assistant_enabled: settings.enabled,
    tokens: rows.map((r) => ({
      id: r.id,
      kind: r.kind === 'personal' ? 'token' : 'app',
      label: r.client_id ? clientNameById.get(r.client_id) || 'An MCP client' : r.label || 'Access token',
      prefix: r.token_prefix,
      created_at: r.created_at,
      last_used_at: r.last_used_at,
    })),
  })
}

export async function POST(request: Request) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error

  const admin = createAdminClient()
  const settings = await getAssistantSettings(admin, auth.companyId)
  if (!settings.enabled || !settings.mcpEnabled) {
    return NextResponse.json(
      { error: 'Connecting Claude apps is not enabled for this company yet. Ask an admin to turn it on.' },
      { status: 403 },
    )
  }

  const { count } = await admin
    .from('mcp_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', auth.userId)
    .eq('kind', 'personal')
    .is('revoked_at', null)
  if ((count ?? 0) >= MAX_TOKENS_PER_USER) {
    return NextResponse.json(
      { error: 'You already have the maximum number of access tokens. Revoke one first.' },
      { status: 400 },
    )
  }

  let label = 'Access token'
  try {
    const body = (await request.json()) as { label?: unknown }
    if (typeof body.label === 'string' && body.label.trim()) label = body.label.trim().slice(0, 60)
  } catch {
    // keep the default
  }

  const minted = mintMcpToken('personal')
  const { data, error } = await admin
    .from('mcp_tokens')
    .insert({
      token_hash: minted.hash,
      token_prefix: minted.prefix,
      kind: 'personal',
      company_id: auth.companyId,
      user_id: auth.userId,
      label,
    })
    .select('id, created_at')
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ error: 'Could not create a token' }, { status: 500 })
  }

  // The raw value is returned exactly once — we only ever store its hash.
  return NextResponse.json({
    id: (data as { id: string }).id,
    token: minted.raw,
    label,
    mcp_url: canonicalResource(),
  })
}

export async function DELETE(request: Request) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('mcp_tokens')
    .select('id, user_id, client_id, kind')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const t = row as { id: string; user_id: string; client_id: string | null; kind: string }

  const now = new Date().toISOString()
  if (t.kind !== 'personal' && t.client_id) {
    await admin
      .from('mcp_tokens')
      .update({ revoked_at: now })
      .eq('user_id', auth.userId)
      .eq('client_id', t.client_id)
      .is('revoked_at', null)
  } else {
    await admin.from('mcp_tokens').update({ revoked_at: now }).eq('id', t.id).is('revoked_at', null)
  }

  return NextResponse.json({ ok: true })
}
