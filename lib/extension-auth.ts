// Extension / API-token auth. See Reference/PRDs/CHROME_EXTENSION_PRD.md §4.1.
//
// The browser extension (and any future non-cookie client) authenticates with a
// per-user Bearer token instead of a Supabase session cookie. We store only the
// SHA-256 hash of the token in user_api_tokens; the raw value is shown once at
// mint time. Every extension endpoint calls authenticateExtensionRequest() to
// resolve the token → { userId, companyId } (or null), then uses the admin
// client for its work, scoping every query by companyId.
import { createHash, randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'

const TOKEN_PREFIX = 'lyx_ext_'

export type ExtensionAuth = {
  userId: string
  companyId: string
  tokenId: string
}

/** SHA-256 hex of a raw token — what we store and look up by. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/**
 * Mint a new raw token. Returns the raw value (shown to the user ONCE), its
 * hash (stored), and a short display prefix. The raw token is 32 random bytes
 * base64url-encoded behind the "lyx_ext_" marker — long enough that guessing is
 * infeasible and the marker makes it recognizable if it ever leaks into a log.
 */
export function mintToken(): { raw: string; hash: string; prefix: string } {
  const secret = randomBytes(32).toString('base64url')
  const raw = `${TOKEN_PREFIX}${secret}`
  return {
    raw,
    hash: hashToken(raw),
    // e.g. "lyx_ext_ab12…" — enough to tell tokens apart in the list, not enough to use.
    prefix: raw.slice(0, TOKEN_PREFIX.length + 4) + '…',
  }
}

/** Pull the Bearer token out of the Authorization header (or null). */
export function readBearer(request: Request): string | null {
  const h = request.headers.get('authorization') || request.headers.get('Authorization')
  if (!h) return null
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  return m ? m[1].trim() : null
}

/**
 * Resolve an extension request to its owning user + company, or null if the
 * token is missing / unknown / revoked. Best-effort bumps last_used_at so the
 * Settings screen can show activity and stale tokens are obvious. Uses the
 * admin client (no cookie session exists on these calls).
 */
export async function authenticateExtensionRequest(
  request: Request
): Promise<ExtensionAuth | null> {
  const raw = readBearer(request)
  if (!raw || !raw.startsWith(TOKEN_PREFIX)) return null

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('user_api_tokens')
    .select('id, user_id, company_id, revoked_at')
    .eq('token_hash', hashToken(raw))
    .maybeSingle()

  if (error || !data || data.revoked_at) return null

  // Best-effort activity stamp — never block auth on it.
  admin
    .from('user_api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(undefined, () => {})

  return {
    userId: data.user_id as string,
    companyId: data.company_id as string,
    tokenId: data.id as string,
  }
}

// ── CORS ─────────────────────────────────────────────────────────────────────
// Extension fetches come from a chrome-extension:// origin and send an
// Authorization header, which triggers a CORS preflight. These endpoints are
// token-authenticated (no cookies), so a wildcard origin is safe — we never rely
// on ambient credentials. Every extension route returns these headers and
// handles OPTIONS.
export const EXTENSION_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
}

/** Standard preflight response for extension routes. */
export function extensionPreflight(): Response {
  return new Response(null, { status: 204, headers: EXTENSION_CORS_HEADERS })
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Cap abuse from a leaked token. Every extension route runs one or more checks
// keyed by the tokenId right after auth; the first check that trips returns a
// ready 429 (with CORS + Retry-After). Limits are deliberately generous for real
// human use — they only bite runaway/automated traffic.
export function enforceRateLimit(
  checks: Array<{ key: string; limit: number; windowMs: number }>
): Response | null {
  for (const c of checks) {
    const r = rateLimit(c.key, c.limit, c.windowMs)
    if (!r.ok) {
      return new Response(
        JSON.stringify({ error: 'Too many requests — please slow down and try again shortly.' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(r.retryAfter),
            ...EXTENSION_CORS_HEADERS,
          },
        }
      )
    }
  }
  return null
}

// ── Module access ─────────────────────────────────────────────────────────────
// Make extension actions respect the same Hub module gates as the web app: a
// token must not drive a module its owner can't access in the Hub. Scan/extract
// needs no module (the core function is always available); adding to the
// directory has no module flag. Admins pass everything; the txt check mirrors the
// app's isTxtUser (Txt access OR a Txt manager).
export async function tokenUserHasModuleAccess(
  userId: string,
  moduleName: 'txt' | 'tracker' | 'dialer'
): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('user_profiles')
    .select(
      'role, can_admin_txt, can_assign_txt_threads, can_access_txt, can_access_tracker, can_access_dialer'
    )
    .eq('id', userId)
    .maybeSingle()
  if (!data) return false
  if (data.role === 'admin') return true
  if (moduleName === 'txt') {
    return (
      data.can_access_txt === true ||
      data.can_admin_txt === true ||
      data.can_assign_txt_threads === true
    )
  }
  if (moduleName === 'tracker') return data.can_access_tracker === true
  return data.can_access_dialer === true
}
