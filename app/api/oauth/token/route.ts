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
import { rateLimitDb } from '@/lib/rate-limit-db'
import {
  ACCESS_TOKEN_TTL_SEC,
  REFRESH_TOKEN_TTL_SEC,
  hashSecret,
  mintMcpToken,
  resourceIsAcceptable,
  MCP_CORS_HEADERS,
} from '@/lib/mcp-auth'

// ── Rate limiting ───────────────────────────────────────────────────────────
// Keyed on the PRINCIPAL — the client id, or the refresh token being presented
// — and NOT on the caller's IP. claude.ai's token traffic reaches us from a
// small pool of shared Anthropic egress addresses on behalf of many customers,
// so an IP cap tight enough to be a real guardrail throttles unrelated tenants'
// refreshes into an outage the moment the connector sees any adoption. One noisy
// customer must not be able to spend another's budget.
//
// The IP cap survives only as a loose flood ceiling, set far above real traffic:
// an anonymous caller can invent a fresh client_id per request, so without it the
// principal-keyed limits below would have nothing to bite on. It is checked
// before the body is parsed; the principal-keyed ones necessarily come after.
//
// The principal-keyed limits count in Postgres (lib/rate-limit-db.ts) so they
// survive a deploy — an in-process Map would hand an attacker a free reset every
// time we ship. The IP ceiling deliberately stays in-process: it runs before the
// body is even parsed, so its whole job is to be cheap, and it is the one layer
// that must not put a DB round trip in front of a flood.
const IP_FLOOD_PER_MIN = 600
const PER_CLIENT_PER_MIN = 60
// A refresh token is single-use: rotation means a second presentation is already
// treated as reuse and revokes the family. Anything near this is a loop, not a
// client behaving normally.
const PER_REFRESH_TOKEN_PER_MIN = 10

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

/**
 * 429 with a Retry-After the client can actually act on. Expose-Headers is
 * widened here because the base MCP list doesn't carry Retry-After, and a
 * browser-based client can't read it cross-origin otherwise.
 */
function tooManyRequests(retryAfter: number) {
  return NextResponse.json(
    { error: 'temporarily_unavailable', error_description: 'Too many token requests — slow down.' },
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        ...MCP_CORS_HEADERS,
        'Access-Control-Expose-Headers': `${MCP_CORS_HEADERS['Access-Control-Expose-Headers']}, Retry-After`,
        'Retry-After': String(retryAfter),
      },
    },
  )
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
  const flood = rateLimit(`oauth:token:ip:${ip}`, IP_FLOOD_PER_MIN, 60_000)
  if (!flood.ok) return tooManyRequests(flood.retryAfter)

  const params = await readParams(request)
  const grantType = params.grant_type || ''

  // RFC 8707, on both grants. Nothing is stored against the issued token: this
  // server protects exactly one resource, so a token that passed this check can
  // only ever be for that one — checking equality IS the binding. If a second
  // protected resource is ever added, that stops being true and the granted
  // resource has to be recorded on the code and the token instead.
  if (!resourceIsAcceptable(params.resource)) {
    return oauthError(
      'invalid_target',
      'The requested resource is not one this server issues tokens for.',
    )
  }

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

    const perClient = await rateLimitDb(`oauth:token:client:${clientId}`, PER_CLIENT_PER_MIN, 60)
    if (!perClient.ok) return tooManyRequests(perClient.retryAfter)

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

    // Key on the token itself — that's the principal here, and client_id is
    // optional on this grant so it can't be relied on alone.
    const refreshHash = hashSecret(refreshToken)
    const perToken = await rateLimitDb(
      `oauth:token:refresh:${refreshHash}`,
      PER_REFRESH_TOKEN_PER_MIN,
      60,
    )
    if (!perToken.ok) return tooManyRequests(perToken.retryAfter)
    if (clientId) {
      const perClient = await rateLimitDb(`oauth:token:client:${clientId}`, PER_CLIENT_PER_MIN, 60)
      if (!perClient.ok) return tooManyRequests(perClient.retryAfter)
    }

    const { data } = await admin
      .from('mcp_tokens')
      .select('id, kind, company_id, user_id, client_id, expires_at, revoked_at')
      .eq('token_hash', refreshHash)
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
      // Scope the family revoke to this client. With a null client_id, revoke ONLY
      // this row rather than every token the user has — a broad sweep would take
      // out their unrelated personal access tokens.
      let q = admin
        .from('mcp_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .is('revoked_at', null)
      q = row.client_id
        ? q.eq('user_id', row.user_id).eq('client_id', row.client_id)
        : q.eq('id', row.id)
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

    // Don't hand a locked or deactivated person a fresh 90-day rotation. The
    // access token this would mint is already dead on arrival — resolveHubActor
    // rejects both states on every action — so this is tidiness rather than a
    // hole. Worth doing anyway: without it an offboarded employee's connector
    // keeps refreshing indefinitely, which reads as a live grant in the token
    // table and gives no signal that access ended.
    const { data: profile, error: profileErr } = await admin
      .from('user_profiles')
      .select('locked_at, deactivated_at')
      .eq('id', row.user_id)
      .maybeSingle()
    const p = profile as { locked_at: string | null; deactivated_at: string | null } | null

    // A read failure is not evidence of anything. Refuse the rotation (the
    // presented token is still valid and can be retried) but do NOT revoke —
    // destroying a live grant on a transient DB blip is the worse error.
    if (profileErr) return oauthError('temporarily_unavailable', 'Try that again in a moment.')

    if (!p || p.locked_at || p.deactivated_at) {
      // Confirmed inactive: revoke the family rather than only refusing, so the
      // grant stops showing as live and the connector is forced to reconnect.
      let q = admin
        .from('mcp_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .is('revoked_at', null)
      q = row.client_id
        ? q.eq('user_id', row.user_id).eq('client_id', row.client_id)
        : q.eq('id', row.id)
      await q
      return oauthError('invalid_grant', 'That account is no longer active.')
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
