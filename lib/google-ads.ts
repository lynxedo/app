import { createAdminClient } from '@/lib/supabase/admin'
import { getGoogleAccessToken } from '@/lib/google-oauth'

// Google Ads API client — read-only, used to pull Local Services Ads (LSA) leads.
//
// LSA lead data lives in the Google Ads API `local_services_lead` resource (the
// Local Services API is a read-only subset of the Ads API — same OAuth `adwords`
// scope that lib/google-oauth.ts already obtains). ONE platform developer token
// + MCC serve every subscriber; each subscriber's own account is queried by its
// customer id, stored per company on google_connections.customer_id.
//
// No new dependency — we call the REST search endpoint directly with fetch.
//
// ⚠ The API version + the exact GAQL field paths below are validated at the
// first live run (gated on the developer token). If Google renames a field or
// the pinned version is retired, the API returns a 400 naming the offending
// field — adjust the SELECT constant / GOOGLE_ADS_API_VERSION and re-run.

type Admin = ReturnType<typeof createAdminClient>

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v22'
const searchEndpoint = (customerId: string) =>
  `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:search`

// Google Ads customer / manager ids are digits only (strip dashes).
function digits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

export function googleAdsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN)
}

export type LsaLead = {
  id: string
  consumerName: string | null
  phone: string | null
  email: string | null
  categoryId: string | null
  serviceId: string | null
  leadType: string | null
  leadStatus: string | null
  creationDateTime: string | null // "YYYY-MM-DD HH:MM:SS" in the account's timezone
  locale: string | null
}

type GoogleConn = {
  customer_id: string | null
  login_customer_id: string | null
  lsa_last_lead_time: string | null
  lsa_enabled: boolean | null
}

// Long-stable fields only, so an API-version bump is unlikely to break the SELECT.
const LSA_FIELDS = [
  'local_services_lead.id',
  'local_services_lead.lead_type',
  'local_services_lead.lead_status',
  'local_services_lead.category_id',
  'local_services_lead.service_id',
  'local_services_lead.contact_details.consumer_name',
  'local_services_lead.contact_details.phone_number',
  'local_services_lead.contact_details.email',
  'local_services_lead.creation_date_time',
  'local_services_lead.locale',
]

// GAQL wants "YYYY-MM-DD HH:MM:SS".
function gaqlTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

function buildQuery(sinceCursor: string | null): string {
  // First run (no cursor): bound to the last 7 days so we don't flood the Lead
  // Tracker with the account's entire lead history. After that, the stored
  // cursor (a real creation_date_time from the API) drives an exact "> cursor".
  const since = sinceCursor || gaqlTimestamp(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
  return (
    `SELECT ${LSA_FIELDS.join(', ')} ` +
    `FROM local_services_lead ` +
    `WHERE local_services_lead.creation_date_time > '${since}' ` +
    `ORDER BY local_services_lead.creation_date_time ASC LIMIT 200`
  )
}

export type LsaFetchResult = { leads: LsaLead[]; cursor: string | null }

// Fetch LSA leads for one company newer than its stored cursor. Returns null
// when Google/LSA isn't configured for this company (no dev token, not
// connected, no customer id, or LSA disabled) — the poller just skips it.
export async function fetchNewLsaLeads(admin: Admin, companyId: string): Promise<LsaFetchResult | null> {
  if (!googleAdsConfigured()) return null

  const token = await getGoogleAccessToken(admin, companyId)
  if (!token) return null

  const { data } = await admin
    .from('google_connections')
    .select('customer_id, login_customer_id, lsa_last_lead_time, lsa_enabled')
    .eq('company_id', companyId)
    .maybeSingle()
  const conn = data as GoogleConn | null
  if (!conn?.customer_id || conn.lsa_enabled === false) return null

  const customerId = digits(conn.customer_id)
  const loginCustomerId = digits(conn.login_customer_id || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN as string,
    'Content-Type': 'application/json',
  }
  // Present when the queried account is a client under a manager (MCC) account.
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId

  const res = await fetch(searchEndpoint(customerId), {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: buildQuery(conn.lsa_last_lead_time) }),
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[google-ads] LSA query failed for ${companyId}:`, res.status, body.slice(0, 600))
    return null
  }

  const json = (await res.json().catch(() => ({}))) as {
    results?: Array<{ localServicesLead?: Record<string, unknown> }>
  }
  const rows = json.results ?? []

  const leads: LsaLead[] = rows
    .map((r) => {
      const l = (r.localServicesLead ?? {}) as Record<string, unknown>
      const c = (l.contactDetails ?? {}) as Record<string, unknown>
      const str = (v: unknown) => (v == null || v === '' ? null : String(v))
      return {
        id: String(l.id ?? ''),
        consumerName: str(c.consumerName),
        phone: str(c.phoneNumber),
        email: str(c.email),
        categoryId: str(l.categoryId),
        serviceId: str(l.serviceId),
        leadType: str(l.leadType),
        leadStatus: str(l.leadStatus),
        creationDateTime: str(l.creationDateTime),
        locale: str(l.locale),
      }
    })
    .filter((l) => l.id)

  // Advance the cursor to the newest creation time we saw this run.
  const cursor = leads.reduce<string | null>(
    (max, l) => (l.creationDateTime && (!max || l.creationDateTime > max) ? l.creationDateTime : max),
    conn.lsa_last_lead_time,
  )

  return { leads, cursor }
}
