// Bearer-token auth for the official Lynxedo MCP server.
//
// Two token families, both stored as a sha256 hash only (never plaintext) in
// mcp_tokens, mirroring the extension-token pattern in lib/extension-auth.ts:
//
//   lxmcp_  personal access token — pasted into Claude Code / cowork once, no
//           expiry, revoked from Settings.
//   lxoat_  OAuth access token    — issued to a claude.ai connector, 1 hour.
//   lxort_  OAuth refresh token   — rotated on every use.
//
// These live in their own table rather than reusing user_api_tokens so that
// revoking a Claude connection can never disturb someone's browser extension,
// and so OAuth expiry/rotation doesn't have to be bolted onto a table whose
// tokens are deliberately eternal.

import { createHash, randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { readBearer } from '@/lib/extension-auth'

export type McpTokenKind = 'personal' | 'access' | 'refresh'

const PREFIX: Record<McpTokenKind, string> = {
  personal: 'lxmcp_',
  access: 'lxoat_',
  refresh: 'lxort_',
}

/** Access tokens are short-lived; refresh tokens carry the long-lived grant. */
export const ACCESS_TOKEN_TTL_SEC = 60 * 60 // 1 hour
export const REFRESH_TOKEN_TTL_SEC = 60 * 60 * 24 * 90 // 90 days

export function hashSecret(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/** Mint a raw token of the given kind. The raw value is shown/returned ONCE. */
export function mintMcpToken(kind: McpTokenKind): { raw: string; hash: string; prefix: string } {
  const raw = `${PREFIX[kind]}${randomBytes(32).toString('base64url')}`
  return {
    raw,
    hash: hashSecret(raw),
    prefix: raw.slice(0, PREFIX[kind].length + 4) + '…',
  }
}

function looksLikeMcpToken(raw: string): boolean {
  return raw.startsWith(PREFIX.personal) || raw.startsWith(PREFIX.access)
}

export type McpAuth = {
  userId: string
  companyId: string
  tokenId: string
  kind: McpTokenKind
  clientId: string | null
}

/**
 * Resolve a request's bearer token to its owning user + company, or null when it
 * is missing, malformed, unknown, revoked, or expired. Refresh tokens are
 * deliberately NOT accepted here — they only work at the token endpoint.
 */
export async function authenticateMcpRequest(request: Request): Promise<McpAuth | null> {
  const raw = readBearer(request)
  if (!raw || !looksLikeMcpToken(raw)) return null

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('mcp_tokens')
    .select('id, user_id, company_id, kind, client_id, expires_at, revoked_at')
    .eq('token_hash', hashSecret(raw))
    .maybeSingle()

  if (error || !data) return null
  const row = data as {
    id: string
    user_id: string
    company_id: string
    kind: string
    client_id: string | null
    expires_at: string | null
    revoked_at: string | null
  }
  if (row.revoked_at) return null
  if (row.kind === 'refresh') return null
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return null

  // Best-effort activity stamp — never block auth on it.
  admin
    .from('mcp_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id)
    .then(undefined, () => {})

  return {
    userId: row.user_id,
    companyId: row.company_id,
    tokenId: row.id,
    kind: row.kind as McpTokenKind,
    clientId: row.client_id,
  }
}

/** Revoke every live token for one OAuth client + user (used by "disconnect"). */
export async function revokeMcpTokens(opts: {
  userId: string
  clientId?: string | null
  tokenId?: string | null
}): Promise<number> {
  const admin = createAdminClient()
  let q = admin
    .from('mcp_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', opts.userId)
    .is('revoked_at', null)
  if (opts.tokenId) q = q.eq('id', opts.tokenId)
  if (opts.clientId) q = q.eq('client_id', opts.clientId)
  const { data } = await q.select('id')
  return (data || []).length
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────

export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://lynxedo.com').replace(/\/$/, '')
}

/**
 * MCP clients are browser-based (claude.ai) or native, send an Authorization
 * header, and never rely on cookies — so a wildcard origin is safe here for the
 * same reason it is on the extension endpoints. Mcp-Session-Id and
 * MCP-Protocol-Version must be both allowed and exposed for spec compliance.
 */
export const MCP_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate',
  'Access-Control-Max-Age': '86400',
}

export function mcpPreflight(): Response {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS })
}

export function mcpJson(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...MCP_CORS_HEADERS, ...(extra || {}) },
  })
}

/**
 * A 401 that tells an MCP client where to start OAuth. Without this header a
 * client can only report "unauthorized"; with it, claude.ai discovers our
 * authorization server and runs the sign-in flow on its own.
 */
export function mcpUnauthorized(message = 'Authentication required'): Response {
  return mcpJson({ error: 'unauthorized', error_description: message }, 401, {
    'WWW-Authenticate': `Bearer realm="Lynxedo", resource_metadata="${appOrigin()}/.well-known/oauth-protected-resource"`,
  })
}
