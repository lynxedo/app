import { createAdminClient } from '@/lib/supabase/admin'
import { getGoogleAccessToken } from '@/lib/google-oauth'

// Google Ads API client — pulls Local Services Ads (LSA) leads, and sends a
// reply back into an LSA lead's own Google conversation.
//
// LSA lead data lives in the Google Ads API `local_services_lead` resource (the
// Local Services API is a subset of the Ads API — same OAuth `adwords` scope
// that lib/google-oauth.ts already obtains; that scope covers the reply mutate
// too, so replying needs no re-consent). ONE platform developer token
// + MCC serve every subscriber; each subscriber's own account is queried by its
// customer id, stored per company on google_connections.customer_id.
//
// WHY replies go through Google instead of a plain text: Google only scores
// responsiveness (its top LSA ranking factor) on activity it can see — a call
// answered on the LSA number or a reply inside the LSA message thread. A text
// sent from our own Twilio number is invisible to Google, so it earns no credit
// no matter how fast it goes out. appendLeadConversation puts the reply in
// Google's system, and Google relays it on to the customer.
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
// Verified against the v22 service proto's google.api.http annotation:
//   post: "/v22/customers/{customer_id=*}/localServices:appendLeadConversation"
const appendConversationEndpoint = (customerId: string) =>
  `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/localServices:appendLeadConversation`

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
// NOTE: contact_details is selected as the whole MESSAGE (verified against the v22
// google_ads_field schema) — its consumer_name / phone_number / email are NOT
// individually selectable via dotted paths. Google returns them nested under
// contactDetails in the response (some leads are phone-only, some email-only).
const LSA_FIELDS = [
  'local_services_lead.id',
  'local_services_lead.lead_type',
  'local_services_lead.lead_status',
  'local_services_lead.category_id',
  'local_services_lead.service_id',
  'local_services_lead.contact_details',
  'local_services_lead.creation_date_time',
  'local_services_lead.locale',
]

// GAQL filters creation_date_time as a DATE — it must be 'YYYY-MM-DD' (a full
// timestamp 400s with INVALID_DATE_FORMAT). So the cursor is used day-granular
// with >= ; leads.external_lead_id dedup skips leads already ingested that day.
function gaqlDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function buildQuery(sinceCursor: string | null): string {
  // First run (no cursor): last 7 days so we don't flood the Lead Tracker with
  // the account's whole history. Otherwise the cursor's DATE; same-day re-fetches
  // are harmless (deduped). Slicing to 10 chars turns any timestamp into 'YYYY-MM-DD'.
  const since = sinceCursor ? sinceCursor.slice(0, 10) : gaqlDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
  return (
    `SELECT ${LSA_FIELDS.join(', ')} ` +
    `FROM local_services_lead ` +
    `WHERE local_services_lead.creation_date_time >= '${since}' ` +
    `ORDER BY local_services_lead.creation_date_time ASC LIMIT 200`
  )
}

// Everything a Local Services call needs: the subscriber's customer id plus the
// auth headers. Returns null when Google/LSA isn't usable for this company (no
// dev token, not connected, no customer id, or LSA switched off) — callers treat
// null as "skip this company", never as an error.
type LsaContext = { customerId: string; headers: Record<string, string>; conn: GoogleConn }

async function lsaContext(admin: Admin, companyId: string): Promise<LsaContext | null> {
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

  return { customerId, headers, conn }
}

export type LsaReplyResult =
  | { ok: true; conversationName: string | null }
  | { ok: false; error: string; retryable: boolean }

// Send a reply INTO an LSA lead's Google conversation. Google delivers it to the
// customer on whichever channel they used (text or email) and — the whole point —
// logs it as a response inside Google's own system.
//
// `googleLeadId` is the bare numeric Google lead id (what leads.external_lead_id
// stores behind its `glsa_` prefix). Per the v22 proto, a Conversation needs
// exactly two fields: localServicesLead (resource name) + text, both REQUIRED.
//
// Per-conversation failures come back as a partialFailureError INSIDE a 200
// response, so a 200 alone does not mean the reply landed — the body is checked.
export async function sendLsaLeadReply(
  admin: Admin,
  companyId: string,
  googleLeadId: string,
  text: string,
): Promise<LsaReplyResult> {
  const leadId = digits(googleLeadId)
  if (!leadId) return { ok: false, error: 'missing_google_lead_id', retryable: false }
  if (!text.trim()) return { ok: false, error: 'empty_message', retryable: false }

  const ctx = await lsaContext(admin, companyId)
  if (!ctx) return { ok: false, error: 'lsa_not_configured', retryable: false }

  let res: Response
  try {
    res = await fetch(appendConversationEndpoint(ctx.customerId), {
      method: 'POST',
      headers: ctx.headers,
      body: JSON.stringify({
        conversations: [
          {
            localServicesLead: `customers/${ctx.customerId}/localServicesLeads/${leadId}`,
            text,
          },
        ],
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    })
  } catch (e) {
    // Network/timeout — worth another attempt on the next cron tick.
    return { ok: false, error: `network: ${e instanceof Error ? e.message : 'unknown'}`, retryable: true }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[google-ads] LSA reply failed for ${companyId} lead ${leadId}:`, res.status, body.slice(0, 600))
    // 5xx / 429 are transient; a 4xx means this lead can't be replied to (e.g. a
    // phone-call lead with no conversation, or one past Google's reply window).
    return { ok: false, error: `http_${res.status}: ${body.slice(0, 200)}`, retryable: res.status >= 500 || res.status === 429 }
  }

  const json = (await res.json().catch(() => ({}))) as {
    responses?: Array<{ localServicesLeadConversation?: string; partialFailureError?: { message?: string } }>
  }
  const first = json.responses?.[0]
  if (first?.partialFailureError) {
    const msg = first.partialFailureError.message || 'partial_failure'
    console.error(`[google-ads] LSA reply partial failure for lead ${leadId}:`, msg.slice(0, 400))
    return { ok: false, error: `partial_failure: ${msg.slice(0, 200)}`, retryable: false }
  }

  return { ok: true, conversationName: first?.localServicesLeadConversation ?? null }
}

export type LsaFetchResult = { leads: LsaLead[]; cursor: string | null }

// Fetch LSA leads for one company newer than its stored cursor. Returns null
// when Google/LSA isn't configured for this company (no dev token, not
// connected, no customer id, or LSA disabled) — the poller just skips it.
export async function fetchNewLsaLeads(admin: Admin, companyId: string): Promise<LsaFetchResult | null> {
  const ctx = await lsaContext(admin, companyId)
  if (!ctx) return null
  const { customerId, headers, conn } = ctx

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
