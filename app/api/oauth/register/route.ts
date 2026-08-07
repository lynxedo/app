// RFC 7591 dynamic client registration.
//
// MCP clients (claude.ai, Claude Code) register themselves before sending a user
// to consent. Registration is intentionally open — it has to be, since we can't
// pre-enroll every client — and it grants NOTHING on its own: a registered
// client can only ever act after a real human signs in and approves it, and the
// consent screen names the client so the user sees who they're approving.
//
// The security that matters is downstream: exact-match redirect_uri, PKCE, and
// per-user consent.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimitDb } from '@/lib/rate-limit-db'
import { MCP_CORS_HEADERS } from '@/lib/mcp-auth'

const MAX_REDIRECT_URIS = 10

// Registration is genuinely anonymous — there is no principal to key a limit on,
// so per-IP is all we have. It is set high because claude.ai registers a client
// per connecting user from a shared pool of Anthropic egress addresses: a cap
// tuned for one abusive host would instead block real customers registering
// behind the same egress IP. The cost of the looser cap is junk rows in
// mcp_oauth_clients, which grant nothing on their own (see the header note) —
// the cost of the tighter one was blocking legitimate onboarding.
const REGISTRATIONS_PER_IP_PER_HOUR = 200

export function OPTIONS() {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS })
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: MCP_CORS_HEADERS })
}

/**
 * A redirect URI must be either https, or a loopback http URL (which is how
 * desktop/CLI clients receive the code). Anything else — a custom scheme we
 * can't reason about, an http URL on a real host — is refused.
 */
function isAcceptableRedirectUri(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.hash) return false
  if (u.protocol === 'https:') return true
  if (u.protocol === 'http:') {
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]'
  }
  return false
}

export async function POST(request: Request) {
  // Registration is unauthenticated by design, so it needs its own ceiling.
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown'
  // Counted in Postgres, not in a per-process Map: an hour-long window that a
  // deploy resets is barely a window at all.
  const limit = await rateLimitDb(`oauth:register:${ip}`, REGISTRATIONS_PER_IP_PER_HOUR, 3_600)
  if (!limit.ok) {
    return new NextResponse(
      JSON.stringify({
        error: 'temporarily_unavailable',
        error_description: 'Too many registrations — try again later.',
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          ...MCP_CORS_HEADERS,
          'Access-Control-Expose-Headers': `${MCP_CORS_HEADERS['Access-Control-Expose-Headers']}, Retry-After`,
          'Retry-After': String(limit.retryAfter),
        },
      },
    )
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'invalid_client_metadata', error_description: 'Body must be JSON.' }, 400)
  }

  const rawUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : []
  const redirectUris = rawUris.filter((u): u is string => typeof u === 'string' && u.length > 0)
  if (redirectUris.length === 0) {
    return json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris is required.' }, 400)
  }
  if (redirectUris.length > MAX_REDIRECT_URIS) {
    return json({ error: 'invalid_redirect_uri', error_description: 'Too many redirect_uris.' }, 400)
  }
  const bad = redirectUris.find((u) => !isAcceptableRedirectUri(u))
  if (bad) {
    return json(
      {
        error: 'invalid_redirect_uri',
        error_description: `redirect_uri must be https (or http on loopback): ${bad}`,
      },
      400,
    )
  }

  const clientName =
    typeof body.client_name === 'string' && body.client_name.trim()
      ? body.client_name.trim().slice(0, 120)
      : 'An MCP client'

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('mcp_oauth_clients')
    .insert({
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none',
    })
    .select('id, created_at')
    .maybeSingle()

  if (error || !data) {
    return json({ error: 'server_error', error_description: 'Could not register the client.' }, 500)
  }
  const row = data as { id: string; created_at: string }

  return json(
    {
      client_id: row.id,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_id_issued_at: Math.floor(Date.parse(row.created_at) / 1000),
    },
    201,
  )
}
