/**
 * Jobber API helper
 * - getJobberToken: returns a valid access token, auto-refreshing if < 5 min from expiry
 * - jobberGraphQL: makes an authenticated GraphQL request to Jobber
 */

import { createClient } from '@/lib/supabase/server'

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
  })

  if (!res.ok) {
    console.error('Jobber token refresh failed:', res.status, await res.text())
    return null
  }

  const tokens = await res.json()
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  const supabase = await createClient()
  await supabase
    .from('jobber_tokens')
    .update({
      access_token: tokens.access_token,
      // Jobber may or may not return a new refresh_token — keep old one if not
      refresh_token: tokens.refresh_token ?? refreshToken,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)

  return tokens.access_token
}

// ── GraphQL wrapper ──────────────────────────────────────────────────────────

export async function jobberGraphQL<T = unknown>(
  userId: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const token = await getJobberToken(userId)
  if (!token) throw new Error('No Jobber token — user needs to reconnect')

  const res = await fetch(JOBBER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-JOBBER-GRAPHQL-VERSION': JOBBER_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
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
