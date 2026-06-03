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

async function refreshJobberToken(
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
    return null
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
export async function jobberGraphQLAdmin<T = unknown>(
  userId: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  return jobberGraphQLWith(getJobberTokenAdmin, userId, query, variables)
}

async function jobberGraphQLWith<T = unknown>(
  getToken: (userId: string) => Promise<string | null>,
  userId: string,
  query: string,
  variables?: Record<string, unknown>
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
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    throw new Error(`Jobber API HTTP ${res.status}: ${await res.text()}`)
  }

  return res.json() as Promise<T>
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
