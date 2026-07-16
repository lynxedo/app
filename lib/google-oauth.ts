import { createAdminClient } from '@/lib/supabase/admin'

// Google OAuth for the Google Ads API — which ALSO covers Local Services Ads
// (LSA is a read-only subset of the Google Ads API, same scope). Connecting a
// Google account once is the shared foundation for both the LSA lead poller and
// any Google Ads data pulls — build the connection here, both features ride it.
//
// One connection per company, stored in google_connections (service-role only)
// and auto-refreshed below (the same pattern as lib/gusto.ts). The subscriber
// connects THEIR OWN Google account (the one with access to their LSA / Ads
// account); Lynxedo rides a single platform OAuth client + developer token
// (see Reference/PRDs/INTEGRATIONS_PRD.md §7). Tokens are plaintext, matching the
// existing jobber_tokens / gusto_connections handling (encryption is a follow-up).
//
// ⚠ Refresh tokens are long-lived once the OAuth app is published/verified. While
// the app is still in Google's "Testing" publishing status they expire after ~7
// days — a reconnect fixes it, and getGoogleAccessToken() clears the stale token
// so the UI can prompt one. OAuth verification is the real launch gate for LSA.

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

// `adwords` authorizes both the Google Ads API and the Local Services API.
// openid + email let us show which Google account is connected (not sensitive —
// only `adwords` drives the verification burden).
export const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/adwords',
].join(' ')

type Admin = ReturnType<typeof createAdminClient>

export function googleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET)
}

export function googleRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${base}/api/auth/google/callback`
}

export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? '',
    redirect_uri: googleRedirectUri(),
    scope: GOOGLE_OAUTH_SCOPES,
    access_type: 'offline',       // required to receive a refresh token
    prompt: 'consent',            // force refresh-token issuance, incl. on reconnect
    include_granted_scopes: 'true',
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params}`
}

export type GoogleTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  id_token?: string
  error?: string
  error_description?: string
}

export async function exchangeGoogleCode(code: string): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? '',
      redirect_uri: googleRedirectUri(),
    }),
  })
  return (await res.json().catch(() => ({}))) as GoogleTokenResponse
}

// Best-effort: which Google account authorized (shown as "Connected as …").
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const info = (await res.json()) as { email?: string }
    return info?.email ?? null
  } catch {
    return null
  }
}

// Returns a live access token (refreshing if within 5 min of expiry), or null
// when Google isn't connected / the refresh failed (→ the UI shows "Connect").
// The LSA poller and any Ads API caller go through this.
export async function getGoogleAccessToken(admin: Admin, companyId: string): Promise<string | null> {
  const { data: conn } = await admin
    .from('google_connections')
    .select('access_token, refresh_token, token_expires_at')
    .eq('company_id', companyId)
    .maybeSingle()
  if (!conn?.refresh_token) return null

  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0
  if (conn.access_token && Date.now() + 5 * 60 * 1000 < expiresAt) {
    return conn.access_token
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
      client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? '',
    }),
  })
  const tokens = (await res.json().catch(() => ({}))) as GoogleTokenResponse
  if (!res.ok || !tokens.access_token) {
    // invalid_grant → the refresh token was revoked or expired (e.g. the
    // testing-mode 7-day expiry). Clear the dead access token so the poller
    // stops and the admin UI prompts a reconnect.
    console.error('[google] token refresh failed:', res.status, tokens.error ?? '')
    await admin
      .from('google_connections')
      .update({ access_token: null, token_expires_at: null, updated_at: new Date().toISOString() })
      .eq('company_id', companyId)
    return null
  }

  const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600
  await admin
    .from('google_connections')
    .update({
      access_token: tokens.access_token,
      // Google does NOT normally return a new refresh_token on refresh — keep ours.
      refresh_token: tokens.refresh_token ?? conn.refresh_token,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)

  return tokens.access_token
}

// Tear down a connection: best-effort revoke at Google, then delete our copy.
export async function disconnectGoogle(admin: Admin, companyId: string): Promise<void> {
  const { data } = await admin
    .from('google_connections')
    .select('refresh_token')
    .eq('company_id', companyId)
    .maybeSingle()
  if (data?.refresh_token) {
    try {
      await fetch(GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: data.refresh_token }),
      })
    } catch {
      /* ignore — we still delete our copy below */
    }
  }
  await admin.from('google_connections').delete().eq('company_id', companyId)
}
