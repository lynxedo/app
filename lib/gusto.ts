import { createAdminClient } from '@/lib/supabase/admin'

// Gusto OAuth + API helpers. Tokens live in gusto_connections (one row per
// company) and are auto-refreshed here — Gusto access tokens expire after
// ~2 hours and the refresh token ROTATES on every refresh, so the new pair
// must always be persisted before the old one is discarded.

const GUSTO_API = 'https://api.gusto.com'
export const GUSTO_TOKEN_URL = `${GUSTO_API}/oauth/token`
export const GUSTO_AUTHORIZE_URL = `${GUSTO_API}/oauth/authorize`

// Heroes' Gusto company — fallback for a legacy env-token setup or a stored
// connection whose token_info didn't include the company uuid.
const FALLBACK_COMPANY_UUID = '2482737f-6211-430e-91f0-8a9726ae53d9'

type Admin = ReturnType<typeof createAdminClient>

export type GustoAuth = { token: string; companyUuid: string }

export type GustoEmployee = {
  uuid: string
  first_name: string
  last_name: string
  preferred_first_name?: string
  email: string | null
  phone?: string
  department?: string
  terminated: boolean
  jobs?: Array<{
    title?: string
    compensations?: Array<{
      rate: string
      payment_unit: string
      flsa_status: string
    }>
  }>
}

export type DerivedComp = {
  payType: 'hourly' | 'salary'
  rate: number | null
  flsa: string | null
  title: string | null
}

// Single source of truth for turning a Gusto employee record into the fields
// we store — used by BOTH the match preview and the apply step so the two
// paths can never derive different values from the same record.
export function deriveGustoComp(ge: GustoEmployee): DerivedComp {
  const job = ge.jobs?.[0]
  const comp = job?.compensations?.[0]
  const payType: 'hourly' | 'salary' = comp?.payment_unit === 'Hour' ? 'hourly' : 'salary'
  const rate = payType === 'hourly' ? (parseFloat(comp?.rate ?? '0') || null) : null
  return { payType, rate, flsa: comp?.flsa_status ?? null, title: job?.title ?? null }
}

export async function hasGustoConnection(admin: Admin, companyId: string): Promise<boolean> {
  const { data } = await admin
    .from('gusto_connections')
    .select('company_id')
    .eq('company_id', companyId)
    .maybeSingle()
  return Boolean(data) || Boolean(process.env.GUSTO_ACCESS_TOKEN)
}

// Returns a live access token (refreshing if needed), or null when Gusto is
// not connected / the refresh failed (→ show "Connect Gusto" in the UI).
export async function getGustoAuth(admin: Admin, companyId: string): Promise<GustoAuth | null> {
  const { data: conn } = await admin
    .from('gusto_connections')
    .select('access_token, refresh_token, expires_at, gusto_company_uuid')
    .eq('company_id', companyId)
    .maybeSingle()

  if (!conn) {
    const envToken = process.env.GUSTO_ACCESS_TOKEN
    return envToken ? { token: envToken, companyUuid: FALLBACK_COMPANY_UUID } : null
  }

  const companyUuid = conn.gusto_company_uuid || FALLBACK_COMPANY_UUID
  const expiresAt = new Date(conn.expires_at).getTime()
  if (Date.now() + 5 * 60 * 1000 < expiresAt) {
    return { token: conn.access_token, companyUuid }
  }

  const res = await fetch(GUSTO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
      client_id: process.env.GUSTO_CLIENT_ID ?? '',
      client_secret: process.env.GUSTO_CLIENT_SECRET ?? '',
    }),
  })
  if (!res.ok) {
    console.error('[gusto] token refresh failed:', res.status, await res.text().catch(() => ''))
    return null
  }
  const tokens = await res.json()
  if (!tokens.access_token) return null

  const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : 7200
  await admin
    .from('gusto_connections')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? conn.refresh_token,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)

  return { token: tokens.access_token, companyUuid }
}

export async function fetchGustoEmployees(auth: GustoAuth): Promise<GustoEmployee[]> {
  const res = await fetch(
    `${GUSTO_API}/v1/companies/${auth.companyUuid}/employees?terminated=false&per=100`,
    { headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' } }
  )
  if (!res.ok) {
    throw new Error(`Gusto API error: ${res.status} ${res.statusText}`)
  }
  return await res.json() as GustoEmployee[]
}

// Best-effort company uuid for a fresh token (used once at connect time).
export async function fetchGustoCompanyUuid(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${GUSTO_API}/v1/token_info`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const info = await res.json()
    return info?.resource?.uuid ?? info?.company_uuid ?? null
  } catch {
    return null
  }
}
