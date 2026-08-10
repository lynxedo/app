/**
 * Jobber API helper
 * - getJobberToken: returns a valid access token, auto-refreshing if < 5 min from expiry
 * - jobberGraphQL: makes an authenticated GraphQL request to Jobber
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const JOBBER_CLIENT_ID = process.env.JOBBER_CLIENT_ID!
const JOBBER_CLIENT_SECRET = process.env.JOBBER_CLIENT_SECRET!
const JOBBER_TOKEN_URL = 'https://api.getjobber.com/api/oauth/token'
const JOBBER_API_URL = 'https://api.getjobber.com/api/graphql'
const JOBBER_API_VERSION = '2026-04-22'

// ── Token retrieval ──────────────────────────────────────────────────────────

export async function getJobberToken(userId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('jobber_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .single()

  if (error || !data) return null

  // Refresh if < 5 min from expiry
  const expiresAt = new Date(data.expires_at).getTime()
  const bufferMs = 5 * 60 * 1000
  if (Date.now() + bufferMs >= expiresAt) {
    return refreshJobberToken(userId, data.refresh_token)
  }

  return data.access_token
}

// ── Token refresh ────────────────────────────────────────────────────────────

/**
 * In-flight refreshes, keyed by user id — the fix for a REAL production bug.
 *
 * Jobber has refresh-token ROTATION on: a successful refresh returns a new
 * refresh_token and invalidates the old one immediately. Refresh is triggered
 * lazily by whoever happens to read the token inside the 5-minute pre-expiry
 * window, and webhooks arrive in bursts (one invoice fires ~4 events back to
 * back). Without coordination every caller in that window read the SAME
 * refresh_token and raced: the first won, and every other one got a 401 —
 * dropping its webhook event permanently, because the route has already acked
 * 200 to Jobber and Jobber therefore never retries.
 *
 * Measured on prod before this fix: 293 × "refresh failed: 401" and 242 webhook
 * events lost, in ~40 small clusters spread across the log — one per hour-ish,
 * matching the 60-minute token lifetime rather than any outage.
 *
 * Callers within one process now share a single refresh. Cross-process races
 * (⚠ staging and prod share this DB and these token rows) are handled by the
 * re-read fallback in `performRefresh`, not by this map.
 */
const inFlightRefreshes = new Map<string, Promise<string | null>>()

function refreshJobberToken(userId: string, refreshToken: string): Promise<string | null> {
  const existing = inFlightRefreshes.get(userId)
  if (existing) return existing

  const p = performRefresh(userId, refreshToken).finally(() => {
    inFlightRefreshes.delete(userId)
  })
  inFlightRefreshes.set(userId, p)
  return p
}

/**
 * Read back the stored token when our own refresh was rejected. A 401 on refresh
 * usually means SOMEONE ELSE already rotated it successfully (another process —
 * see the note above), in which case a valid access_token is now sitting in the
 * row and failing would be wrong. Short delay first so a refresh that is still
 * in flight elsewhere has a chance to land.
 */
async function reReadRotatedToken(userId: string): Promise<string | null> {
  await new Promise(r => setTimeout(r, 750))
  const admin = createAdminClient()
  const { data } = await admin
    .from('jobber_tokens')
    .select('access_token, expires_at')
    .eq('user_id', userId)
    .single()
  if (!data?.access_token) return null
  // Only trust it if it is genuinely usable — not merely present.
  if (new Date(data.expires_at).getTime() <= Date.now()) return null
  console.log('[jobber] refresh 401 but a newer token was already stored — using it')
  return data.access_token
}

async function performRefresh(
  userId: string,
  refreshToken: string
): Promise<string | null> {
  const res = await fetch(JOBBER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: JOBBER_CLIENT_ID,
      client_secret: JOBBER_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) {
    console.error('Jobber token refresh failed:', res.status, await res.text())
    // 400/401 here is the rotation race: our refresh_token was already spent by
    // another refresh that succeeded. Check the row before giving up — returning
    // null would drop a webhook event for no reason.
    if (res.status === 401 || res.status === 400) return reReadRotatedToken(userId)
    return null
  }

  const tokens = await res.json()

  // Jobber sometimes returns 200 with an error body (no access_token), and
  // sometimes returns 200 with the tokens but no `expires_in`. Both cases
  // used to crash this function — `new Date(Date.now() + undefined * 1000)`
  // throws on `.toISOString()` — so the rotated refresh_token would never be
  // saved, leaving the dead one in the DB and forcing the user to reconnect
  // on every visit. Mirror the same guards the auth callback already uses.
  if (!tokens.access_token) {
    console.error('Jobber refresh: 200 OK but no access_token:', JSON.stringify(tokens))
    // Same rotation race as the non-2xx branch above — a spent refresh_token can
    // come back this way too, so check the row before giving up.
    return reReadRotatedToken(userId)
  }
  const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

  // Use admin client (service role) for the write. Refresh is a system
  // operation — it must not depend on the user-session RLS policy allowing
  // UPDATE on jobber_tokens. With rotation ON, every successful refresh
  // returns a NEW refresh_token and the old one is invalidated immediately
  // by Jobber, so this save MUST land or the next refresh will 401.
  const admin = createAdminClient()
  const { error: writeErr } = await admin
    .from('jobber_tokens')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? refreshToken,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)

  if (writeErr) {
    console.error('Jobber refresh: failed to save rotated tokens:', writeErr)
    // Don't return the access_token — it would work once but the next
    // refresh would fail because the new refresh_token wasn't saved.
    return null
  }

  return tokens.access_token
}

// ── Token retrieval (service-role / no user session) ─────────────────────────

// Same as getJobberToken, but reads the jobber_tokens row via the admin
// (service-role) client instead of the user-session client. Use this from
// background jobs / cron / detached tasks that have NO authenticated user —
// e.g. the Jobber→Supabase sync (lib/jobber-sync.ts), which runs fire-and-forget
// after the HTTP request has already returned. With the user-session client the
// RLS SELECT policy (auth.uid() = user_id) returns zero rows and the token reads
// back null ("user needs to reconnect") even though a valid token exists.
export async function getJobberTokenAdmin(userId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('jobber_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .single()

  if (error || !data) return null

  // Refresh if < 5 min from expiry (refreshJobberToken already writes via admin)
  const expiresAt = new Date(data.expires_at).getTime()
  const bufferMs = 5 * 60 * 1000
  if (Date.now() + bufferMs >= expiresAt) {
    return refreshJobberToken(userId, data.refresh_token)
  }

  return data.access_token
}

// ── GraphQL wrapper ──────────────────────────────────────────────────────────

export async function jobberGraphQL<T = unknown>(
  userId: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  return jobberGraphQLWith(getJobberToken, userId, query, variables)
}

// Admin-client variant — see getJobberTokenAdmin. Use from background/cron jobs.
// Throws on GraphQL errors returned in the 200 body (Jobber returns "Throttled"
// and field errors this way) so callers' retry/backoff can react and the error
// surfaces instead of crashing later on an undefined `data`.
export async function jobberGraphQLAdmin<T = unknown>(
  userId: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  return jobberGraphQLWith(getJobberTokenAdmin, userId, query, variables, true)
}

// Find a Jobber-connected user in the company so admin-token mutations work
// regardless of which user is signed in (techs don't connect their own Jobber
// account; the connection is usually one admin user). Returns `preferUserId`
// if THAT user has a token, otherwise any company user that does, else null.
// Use with jobberGraphQLAdmin from any path where the signed-in user may not be
// the Jobber-connected account (Daily Log v2 complete, dialer notes, etc.).
export async function companyJobberUserId(
  companyId: string,
  preferUserId: string,
): Promise<string | null> {
  const admin = createAdminClient()
  const { data: profs } = await admin
    .from('user_profiles')
    .select('id')
    .eq('company_id', companyId)
  const ids = (profs ?? []).map((p) => p.id as string)
  if (ids.length === 0) return null
  const { data: toks } = await admin
    .from('jobber_tokens')
    .select('user_id')
    .in('user_id', ids)
  const tokenUsers = new Set((toks ?? []).map((t) => t.user_id as string))
  if (tokenUsers.has(preferUserId)) return preferUserId
  return tokenUsers.size ? [...tokenUsers][0] : null
}

async function jobberGraphQLWith<T = unknown>(
  getToken: (userId: string) => Promise<string | null>,
  userId: string,
  query: string,
  variables?: Record<string, unknown>,
  throwOnGraphQLErrors = false
): Promise<T> {
  const token = await getToken(userId)
  if (!token) throw new Error('No Jobber token — user needs to reconnect')

  const res = await fetch(JOBBER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-JOBBER-GRAPHQL-VERSION': JOBBER_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    throw new Error(`Jobber API HTTP ${res.status}: ${await res.text()}`)
  }

  const json = await res.json()
  if (throwOnGraphQLErrors && Array.isArray(json?.errors) && json.errors.length) {
    throw new Error('Jobber GraphQL errors: ' + JSON.stringify(json.errors))
  }
  return json as T
}

// ── Connection check ─────────────────────────────────────────────────────────

export async function isJobberConnected(userId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('jobber_tokens')
    .select('id')
    .eq('user_id', userId)
    .single()
  return !!data
}
