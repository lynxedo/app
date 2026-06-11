// Desktop Dialer Control — Session 4. Reverse phone-number lookup for screen-pop.
//
// Given an inbound/outbound E.164 number, match it against the mirrored Jobber
// `clients` + `contacts` (contact persons) and the `txt_contacts` address book,
// returning a single best identity. The shared call state (use-twilio-device)
// caches this so the call bar, PiP, incoming popup, and notification all show the
// SAME identity from one query.
//
// Phone matching: Jobber stores phones in arbitrary human formats
// ("(281) 254-0991", "281-451-9320", "2812540991"), so clients/contacts are
// matched on the Postgres-generated `phone_digits` column (digits only, with and
// without the leading 1 — migration clients_contacts_phone_digits). txt_contacts
// is E.164-validated at write, so exact equality works there.
//
// txt_contacts created by the inbound-SMS webhook often have a PLACEHOLDER name
// that is just the phone number — those are not display names. When a
// txt_contact has no usable name we keep its id (for Session 6 actions) but fall
// through to the Jobber data for the real name + address + status.

import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/phone'

const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

export type DialerContactStatus = 'lead' | 'customer' | 'archived'

export type DialerLookupMatch = {
  source: 'txt_contact' | 'client'
  name: string | null
  phone: string // the E.164 we matched on
  status: DialerContactStatus | null
  address: string | null
  // Identifiers downstream surfaces need (Session 6 quick actions):
  clientId: string | null // mirror clients.id (uuid)
  jobberClientId: string | null // Jobber client id (clients.external_id) — for notes + deep-link
  jobberWebUri: string | null // deep-link into Jobber
  txtContactId: string | null // txt_contacts.id when one exists
  balance: number | null
}

type ClientRow = {
  id: string
  external_id: string | null
  name: string | null
  first_name: string | null
  last_name: string | null
  company_name: string | null
  is_lead: boolean | null
  is_archived: boolean | null
  balance: number | null
  jobber_web_uri: string | null
}

type Admin = ReturnType<typeof createAdminClient>

const CLIENT_COLS =
  'id, external_id, name, first_name, last_name, company_name, is_lead, is_archived, balance, jobber_web_uri'

// The digit forms a US number might be stored under: full digits, bare 10, 1+10.
function digitVariants(e164: string): string[] {
  const digits = e164.replace(/\D/g, '')
  const last10 = digits.slice(-10)
  return [...new Set([digits, last10, `1${last10}`])].filter(Boolean)
}

// A "name" that is just the phone number in some formatting (the inbound-SMS
// webhook's placeholder) is not a display name.
function usableName(raw: string | null | undefined, e164: string): string | null {
  const t = (raw || '').trim()
  if (!t) return null
  if (!/[a-zA-Z]/.test(t)) {
    const nameDigits = t.replace(/\D/g, '')
    const phoneDigits = e164.replace(/\D/g, '')
    if (!nameDigits) return null
    if (nameDigits === phoneDigits || nameDigits === phoneDigits.slice(-10)) return null
  }
  return t
}

function clientDisplayName(c: ClientRow): string | null {
  if (c.name && c.name.trim()) return c.name.trim()
  const full = [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
  if (full) return full
  if (c.company_name && c.company_name.trim()) return c.company_name.trim()
  return null
}

function clientStatus(c: ClientRow): DialerContactStatus {
  if (c.is_archived) return 'archived'
  if (c.is_lead) return 'lead'
  return 'customer'
}

// Best property address for a client: prefer the billing address, else the first.
async function addressForClient(admin: Admin, companyId: string, clientId: string): Promise<string | null> {
  const { data } = await admin
    .from('properties')
    .select('address_line1, address_line2, city, state, zip, is_billing_address')
    .eq('company_id', companyId)
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('is_billing_address', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const parts = [
    data.address_line1,
    data.address_line2,
    [data.city, data.state].filter(Boolean).join(', '),
    data.zip,
  ]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

// Find a client by phone digits. Prefers a non-archived match when several exist.
async function clientByPhone(admin: Admin, companyId: string, variants: string[]): Promise<ClientRow | null> {
  const { data } = await admin
    .from('clients')
    .select(CLIENT_COLS)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .in('phone_digits', variants)
    .order('is_archived', { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle()
  return (data as ClientRow) ?? null
}

async function clientByExternalId(admin: Admin, companyId: string, externalId: string): Promise<ClientRow | null> {
  const { data } = await admin
    .from('clients')
    .select(CLIENT_COLS)
    .eq('company_id', companyId)
    .eq('source', 'jobber')
    .eq('external_id', externalId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  return (data as ClientRow) ?? null
}

async function clientById(admin: Admin, companyId: string, id: string): Promise<ClientRow | null> {
  const { data } = await admin
    .from('clients')
    .select(CLIENT_COLS)
    .eq('company_id', companyId)
    .eq('id', id)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  return (data as ClientRow) ?? null
}

// Jobber contact PERSONS (spouse's cell, office manager, etc.) — a second phone
// pool beyond the client's primary number.
async function contactPersonByPhone(
  admin: Admin,
  companyId: string,
  variants: string[],
): Promise<{ name: string | null; client_id: string | null } | null> {
  const { data } = await admin
    .from('contacts')
    .select('name, first_name, last_name, client_id, is_primary')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .in('phone_digits', variants)
    .order('is_primary', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const name =
    (data.name && data.name.trim()) ||
    [data.first_name, data.last_name].filter(Boolean).join(' ').trim() ||
    null
  return { name, client_id: (data.client_id as string) || null }
}

// Resolve the best display name for a phone AND persist it onto the
// txt_contacts row when that row's name is still the phone-number placeholder
// the inbound-SMS webhook / responder auto-create. This is what keeps the Txt2
// sidebar, the Contacts tab, and notification pushes showing "Ben Simpson"
// instead of "+12812540991" for callers who exist in the Jobber mirror.
// Returns the resolved name (or null when nothing matched). Never throws.
export async function enrichTxtContactName(
  companyId: string | null,
  phoneRaw: string,
): Promise<string | null> {
  try {
    const match = await lookupByPhone(phoneRaw, companyId)
    if (!match?.name) return null
    if (match.txtContactId) {
      const admin = createAdminClient()
      const { data: tc } = await admin
        .from('txt_contacts')
        .select('name')
        .eq('id', match.txtContactId)
        .maybeSingle()
      // Only overwrite a placeholder (phone-as-name) — never a real saved name.
      if (tc && !usableName(tc.name, match.phone)) {
        await admin
          .from('txt_contacts')
          .update({ name: match.name, updated_at: new Date().toISOString() })
          .eq('id', match.txtContactId)
      }
    }
    return match.name
  } catch (err) {
    console.warn('[dialer-lookup] enrichTxtContactName failed', phoneRaw, err)
    return null
  }
}

export async function lookupByPhone(
  phoneRaw: string,
  companyId?: string | null,
): Promise<DialerLookupMatch | null> {
  const e164 = toE164(phoneRaw)
  if (!e164) return null
  const company = companyId || HEROES_COMPANY_ID
  const admin = createAdminClient()
  const variants = digitVariants(e164)

  // 1) txt_contacts (the texting address book) — exact E.164. Kept for its id +
  //    jobber link even when its name is a webhook placeholder.
  const { data: tc } = await admin
    .from('txt_contacts')
    .select('id, name, jobber_client_id')
    .eq('company_id', company)
    .eq('phone', e164)
    .limit(1)
    .maybeSingle()
  const tcName = tc ? usableName(tc.name, e164) : null

  // 2) Resolve a Jobber client for the identity + enrichment: via the
  //    txt_contact's link, else by phone digits, else through a contact person.
  let client: ClientRow | null = null
  let personName: string | null = null
  if (tc?.jobber_client_id) client = await clientByExternalId(admin, company, tc.jobber_client_id)
  if (!client) client = await clientByPhone(admin, company, variants)
  if (!client) {
    const person = await contactPersonByPhone(admin, company, variants)
    if (person) {
      personName = usableName(person.name, e164)
      if (person.client_id) client = await clientById(admin, company, person.client_id)
    }
  }

  if (!tc && !client && !personName) return null

  return {
    source: tc ? 'txt_contact' : 'client',
    // Prefer an explicit txt-contact name, then the matched person, then the client.
    name: tcName || personName || (client ? clientDisplayName(client) : null),
    phone: e164,
    status: client ? clientStatus(client) : null,
    address: client ? await addressForClient(admin, company, client.id) : null,
    clientId: client?.id ?? null,
    jobberClientId: client?.external_id ?? tc?.jobber_client_id ?? null,
    jobberWebUri: client?.jobber_web_uri ?? null,
    txtContactId: (tc?.id as string) ?? null,
    balance: client && typeof client.balance === 'number' ? client.balance : null,
  }
}
