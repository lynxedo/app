// OAuth 2.1 token endpoint: authorization_code exchange and refresh rotation.
//
// Public clients (no secret), so the code is bound to the requesting client by
// PKCE: the client sent a code_challenge up front and must now present the
// verifier that hashes to it. A stolen code is useless without the verifier.
//
// Refresh tokens ROTATE — using one revokes it and issues a fresh pair. Reusing
// an already-rotated refresh token is treated as a compromise signal and revokes
// the whole family, which is the same posture Supabase's own refresh-token reuse
// detection takes (and which we learned the hard way in the Aug 4 login wedge).

import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import {
  ACCESS_TOKEN_TTL_SEC,
  REFRESH_TOKEN_TTL_SEC,
  hashSecret,
  mintMcpToken,
  MCP_CORS_HEADERS,
} from '@/lib/mcp-auth'

export function OPTIONS() {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS })
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...MCP_CORS_HEADERS },
  })
}

function oauthError(error: string, description: string, status = 400) {
  return json({ error, error_description: description }, status)
}

/** Accept form-encoded (the spec default) or JSON. */
async function readParams(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      const body = (await request.json()) as Record<string, unknown>
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(body)) if (typeof v === 'string') out[k] = v
      return out
    } catch {
      return {}
    }
  }
  try {
    const form = await request.formData()
    const out: Record<string, string> = {}
    for (const [k, v] of form.entries()) if (typeof v === 'string') out[k] = v
    return out
  } catch {
    return {}
  }
}

function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false
  const computed = createHash('sha256').update(verifier, 'utf8').digest('base64url')
  // Both are base64url of a 32-byte digest — equal length, so a plain compare is
  // constant-length; timing here is not a meaningful oracle (the challenge is
  // public, sent by the client itself).
  return computed === challenge
}

async function issueTokenPair(opts: {
  companyId: string
  userId: string
  /** Null only for a legacy row with no client — never an empty string (FK). */
  clientId: string | null
}): Promise<{ access: string; refresh: string } | null> {
  const admin = createAdminClient()
  const access = mintMcpToken('access')
  const refresh = mintMcpToken('refresh')
  const now = Date.now()

  const { error } = await admin.from('mcp_tokens').insert([
    {
      token_hash: access.hash,
      token_prefix: access.prefix,
      kind: 'access',
      company_id: opts.companyId,
      user_id: opts.userId,
      client_id: opts.clientId,
      expires_at: new Date(now + ACCESS_TOKEN_TTL_SEC * 1000).toISOString(),
    },
    {
      token_hash: refresh.hash,
      token_prefix: refresh.prefix,
      kind: 'refresh',
      company_id: opts.companyId,
      user_id: opts.userId,
      client_id: opts.clientId,
      expires_at: new Date(now + REFRESH_TOKEN_TTL_SEC * 1000).toISOString(),
    },
  ])
  if (error) return null
  return { access: access.raw, refresh: refresh.raw }
}

export async function POST(request: Request) {
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown'
  const limit = rateLimit(`oauth:token:${ip}`, 60, 60_000)
  if (!limit.ok) {
    return oauthError('temporarily_unavailable', 'Too many token requests — slow down.', 429)
  }

  const params = await readParams(request)
  const grantType = params.grant_type || ''
  const admin = createAdminClient()

  if (grantType === 'authorization_code') {
    const code = params.code || ''
    const verifier = params.code_verifier || ''
    const redirectUri = params.redirect_uri || ''
    const clientId = params.client_id || ''

    if (!code || !verifier || !redirectUri || !clientId) {
      return oauthError(
        'invalid_request',
        'code, code_verifier, redirect_uri, and client_id are all required.',
      )
    }

    const { data } = await admin
      .from('mcp_oauth_codes')
      .select('id, client_id, company_id, user_id, redirect_uri, code_challenge, expires_at, consumed_at')
      .eq('code_hash', hashSecret(code))
      .maybeSingle()

    if (!data) return oauthError('invalid_grant', 'That authorization code is not valid.')
    const row = data as {
      id: string
      client_id: string
      company_id: string
      user_id: string
      redirect_uri: string
      code_challenge: string
      expires_at: string
      consumed_at: string | null
    }

    if (row.consumed_at) {
      // A replayed code means the code leaked. Kill anything it produced.
      await admin
        .from('mcp_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', row.user_id)
        .eq('client_id', row.client_id)
        .is('revoked_at', null)
      return oauthError('invalid_grant', 'That authorization code was already used.')
    }
    if (Date.parse(row.expires_at) <= Date.now()) {
      return oauthError('invalid_grant', 'That authorization code has expired.')
    }
    if (row.client_id !== clientId) {
      return oauthError('invalid_grant', 'That code was issued to a different client.')
    }
    // Exact match, per OAuth 2.1 — no prefix or wildcard matching.
    if (row.redirect_uri !== redirectUri) {
      return oauthError('invalid_grant', 'redirect_uri does not match the one used to get this code.')
    }
    if (!verifyPkceS256(verifier, row.code_challenge)) {
      return oauthError('invalid_grant', 'PKCE verification failed.')
    }

    // Consume-then-issue, guarded so two concurrent exchanges can't both win.
    const { data: claimed } = await admin
      .from('mcp_oauth_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('consumed_at', null)
      .select('id')
      .maybeSingle()
    if (!claimed) return oauthError('invalid_grant', 'That authorization code was already used.')

    const pair = await issueTokenPair({
      companyId: row.company_id,
      userId: row.user_id,
      clientId: row.client_id,
    })
    if (!pair) return oauthError('server_error', 'Could not issue tokens.', 500)

    return json({
      access_token: pair.access,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SEC,
      refresh_token: pair.refresh,
      scope: 'hub',
    })
  }

  if (grantType === 'refresh_token') {
    const refreshToken = params.refresh_token || ''
    const clientId = params.client_id || ''
    if (!refreshToken) return oauthError('invalid_request', 'refresh_token is required.')

    const { data } = await admin
      .from('mcp_tokens')
      .select('id, kind, company_id, user_id, client_id, expires_at, revoked_at')
      .eq('token_hash', hashSecret(refreshToken))
      .maybeSingle()

    if (!data) return oauthError('invalid_grant', 'That refresh token is not valid.')
    const row = data as {
      id: string
      kind: string
      company_id: string
      user_id: string
      client_id: string | null
      expires_at: string | null
      revoked_at: string | null
    }
    if (row.kind !== 'refresh') return oauthError('invalid_grant', 'That is not a refresh token.')

    if (row.revoked_at) {
      // Reuse of a rotated refresh token — treat the family as compromised.
      let q = admin
        .from('mcp_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', row.user_id)
        .is('revoked_at', null)
      if (row.client_id) q = q.eq('client_id', row.client_id)
      await q
      return oauthError(
        'invalid_grant',
        'That refresh token was already used. For safety this connection has been signed out — reconnect it.',
      )
    }
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
      return oauthError('invalid_grant', 'That refresh token has expired — reconnect.')
    }
    if (clientId && row.client_id && row.client_id !== clientId) {
      return oauthError('invalid_grant', 'That refresh token belongs to a different client.')
    }

    // Rotate: revoke this one (guarded) before issuing the replacement.
    const { data: rotated } = await admin
      .from('mcp_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle()
    if (!rotated) return oauthError('invalid_grant', 'That refresh token was just used.')

    const pair = await issueTokenPair({
      companyId: row.company_id,
      userId: row.user_id,
      clientId: row.client_id,
    })
    if (!pair) return oauthError('server_error', 'Could not issue tokens.', 500)

    return json({
      access_token: pair.access,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SEC,
      refresh_token: pair.refresh,
      scope: 'hub',
    })
  }

  return oauthError('unsupported_grant_type', `grant_type "${grantType}" is not supported.`)
}
