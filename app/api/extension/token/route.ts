import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mintToken } from '@/lib/extension-auth'

// Manage the caller's own browser-extension API tokens. Cookie-session gated
// (this is the Settings UI, a logged-in human managing their own tokens) — the
// TOKENS themselves are what the extension later uses to authenticate.
//
//   GET    → list the caller's tokens (never returns the raw value)
//   POST   → mint a new token (returns the raw value ONCE), body { label? }
//   DELETE ?id=… → revoke a token (sets revoked_at)

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // RLS scopes to the caller; ordered newest-first.
  const { data, error } = await supabase
    .from('user_api_tokens')
    .select('id, label, token_prefix, last_used_at, created_at, revoked_at')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ tokens: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const label: string | null =
    typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 80) : null

  // Resolve the caller's company (tenant-generic — never hardcode Heroes here so
  // the token surface works for any future subscriber). Fall back to the env
  // default only if the profile has no company set.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .maybeSingle()
  const companyId = (profile?.company_id as string | null) || HEROES_COMPANY_ID

  const { raw, hash, prefix } = mintToken()

  // Write with the admin client so the insert can't be blocked by a policy edge
  // case; we've already authenticated the caller and scope to their own id.
  const admin = createAdminClient()
  const { data: created, error } = await admin
    .from('user_api_tokens')
    .insert({
      user_id: user.id,
      company_id: companyId,
      token_hash: hash,
      token_prefix: prefix,
      label,
    })
    .select('id, label, token_prefix, created_at')
    .single()
  if (error || !created) {
    return NextResponse.json({ error: error?.message || 'Token create failed' }, { status: 500 })
  }

  // The raw token is returned exactly once and never stored in plaintext.
  return NextResponse.json({ token: created, raw })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // RLS ensures a user can only revoke their OWN token; scope by user_id too as
  // belt-and-suspenders.
  const { error } = await supabase
    .from('user_api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
