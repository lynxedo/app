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
import { fetchTwilioCallerId, callerIdEnabled } from '@/lib/twilio-caller-id'
import { isPlaceholderName } from '@/lib/contact-name'

const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// Re-dip a number's carrier caller-ID at most about twice a year (also throttles
// re-paying for numbers that come back blank).
const CALLER_ID_TTL_MS = 180 * 24 * 60 * 60 * 1000

export type DialerContactStatus = 'lead' | 'customer' | 'archived'

export type DialerLookupMatch = {
  source: 'txt_contact' | 'client'
  name: string | null
  // True when `name` came from Twilio's carrier caller-ID rather than our own
  // data: the UI labels it as unverified and it is never persisted as a name.
  nameIsCallerId?: boolean
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

// The PostgREST filter that matches a phone against BOTH the primary phone
// (`phone_digits`, in every stored digit form) and every phone on the record
// (`phone_digits_all`, 10-digit forms — see migration 2026-09-30_client_phone_digits_all).
// Before the second half existed, a customer calling from the other number on
// their own Jobber account was "not found" by the receptionist and the screen-pop.
function anyPhoneFilter(variants: string[]): string {
  const last10 = [...new Set(variants.map((v) => v.slice(-10)).filter((v) => v.length === 10))]
  const primary = `phone_digits.in.(${variants.join(',')})`
  return last10.length ? `${primary},phone_digits_all.ov.{${last10.join(',')}}` : primary
}

// Find a client by phone digits. Prefers a non-archived match when several exist.
async function clientByPhone(admin: Admin, companyId: string, variants: string[]): Promise<ClientRow | null> {
  const { data } = await admin
    .from('clients')
    .select(CLIENT_COLS)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .or(anyPhoneFilter(variants))
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
    .or(anyPhoneFilter(variants))
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
    // Never persist a carrier caller-ID guess as the real saved name.
    if (!match?.name || match.nameIsCallerId) return null
    if (match.txtContactId) {
      const admin = createAdminClient()
      const { data: tc } = await admin
        .from('txt_contacts')
        .select('name')
        .eq('id', match.txtContactId)
        .maybeSingle()
      // Only overwrite a placeholder (null / phone-as-name) — never a real saved
      // name. Stamp name_source='jobber' so the name reads as trusted (no AI dot).
      if (tc && !usableName(tc.name, match.phone)) {
        await admin
          .from('txt_contacts')
          // Promote-on-name: a matched Jobber customer belongs in the directory.
          .update({ name: match.name, name_source: 'jobber', in_directory: true, updated_at: new Date().toISOString() })
          .eq('id', match.txtContactId)
      }
    }
    return match.name
  } catch (err) {
    console.warn('[dialer-lookup] enrichTxtContactName failed', phoneRaw, err)
    return null
  }
}

// Find — or create — the txt_contacts row for a phone number, returning its id.
// This is the contact "spine" the Unified Inbox keys on, so the inbound VOICE
// path can link a calls row to a contact the same way the inbound SMS path does
// (previously the voice path only *looked up* an existing contact, leaving
// contact_id NULL for first-time callers). Normalizes to E.164, then:
//   - existing row → return it (enrich a still-nameless row in the background)
//   - none → create with name NULL (an "Unknown" contact) and enrich async, so
//     the hot voice-webhook path isn't blocked on the Jobber-mirror lookup.
// Race-safe against the txt_contacts (company_id, phone) unique constraint.
// Never throws — returns null only when the number can't be normalized.
export async function findOrCreateTxtContact(
  companyId: string,
  phoneRaw: string,
): Promise<string | null> {
  const e164 = toE164(phoneRaw)
  if (!e164) return null
  try {
    const admin = createAdminClient()
    const { data: existing } = await admin
      .from('txt_contacts')
      .select('id, name')
      .eq('company_id', companyId)
      .eq('phone', e164)
      .maybeSingle()
    if (existing) {
      if (isPlaceholderName(existing.name, e164)) void enrichTxtContactName(companyId, e164)
      return existing.id
    }
    // ignoreDuplicates so a concurrent create (e.g. a near-simultaneous inbound
    // SMS) never clobbers a real name back to the placeholder — on conflict the
    // insert is skipped and we re-select the winner below.
    // phone_digits is required: the nightly Jobber sync matches on it, so a row
    // created without it can never be matched (the July 1 `86d7c05` incident).
    const { data: created } = await admin
      .from('txt_contacts')
      .upsert(
        // name '' (an "Unknown" contact — name is NOT NULL), NOT the phone number;
        // enrich fills a real name from Jobber async. phone_digits required (July 1 `86d7c05`).
        { company_id: companyId, phone: e164, phone_digits: e164.replace(/\D/g, '').slice(-10), name: '' },
        { onConflict: 'company_id,phone', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle()
    if (created?.id) {
      void enrichTxtContactName(companyId, e164)
      return created.id
    }
    const { data: again } = await admin
      .from('txt_contacts')
      .select('id')
      .eq('company_id', companyId)
      .eq('phone', e164)
      .maybeSingle()
    return again?.id ?? null
  } catch (err) {
    console.warn('[dialer-lookup] findOrCreateTxtContact failed', phoneRaw, err)
    return null
  }
}

export async function lookupByPhone(
  phoneRaw: string,
  companyId?: string | null,
  opts?: { fetchCallerId?: boolean },
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
    .select('id, name, jobber_client_id, caller_id_name, caller_id_checked_at')
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

  // Prefer an explicit txt-contact name, then the matched person, then the client.
  const internalName = tcName || personName || (client ? clientDisplayName(client) : null)

  // Caller-ID (Twilio CNAM) fallback — reached ONLY when we have no name of our
  // own. Returned clearly flagged so the UI labels it and it is never persisted.
  let callerIdName: string | null = null
  if (!internalName) {
    const cachedName = tc ? usableName(tc.caller_id_name, e164) : null
    const checkedAt = tc?.caller_id_checked_at ? Date.parse(tc.caller_id_checked_at) : 0
    const checkedRecently = checkedAt > 0 && Date.now() - checkedAt < CALLER_ID_TTL_MS
    if (cachedName) {
      callerIdName = cachedName
    } else if (opts?.fetchCallerId && callerIdEnabled() && !checkedRecently) {
      const fetched = await fetchTwilioCallerId(e164)
      // Log the billable Twilio dip (charged whether or not a name comes back) so the
      // Caller ID Look Up usage meter can count it. Fire-and-forget; a dropped log only
      // ever under-counts (never over-bills), matching the surrounding pattern.
      void admin.from('billing_caller_id_lookups').insert({ company_id: company, phone: e164 })
      if (fetched?.name) {
        callerIdName = fetched.name
        if (tc?.id) {
          void admin
            .from('txt_contacts')
            .update({ caller_id_name: fetched.name, caller_id_checked_at: new Date().toISOString() })
            .eq('id', tc.id)
        }
      } else if (tc?.id) {
        // Stamp the check so we don't re-pay for a blank number until the TTL.
        void admin
          .from('txt_contacts')
          .update({ caller_id_checked_at: new Date().toISOString() })
          .eq('id', tc.id)
      }
    }
  }

  const finalName = internalName || callerIdName
  if (!tc && !client && !personName && !finalName) return null

  return {
    source: tc ? 'txt_contact' : 'client',
    name: finalName,
    nameIsCallerId: !internalName && !!callerIdName,
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

// ---------------------------------------------------------------------------
// Find a client by the NAME on the account (+ optionally the service address)
// ---------------------------------------------------------------------------
// The receptionist's fallback when the caller's number matches nothing: she asks
// "what name is the account under?" and "what's the service address?" and calls
// her lookup again with both. Company-scoped, mirror only (no Jobber round-trip).
//
// Deliberately conservative — it returns a client only when the evidence points
// at ONE record. A name alone that matches several households returns
// `ambiguous`, so she asks for the address rather than reading out someone
// else's schedule. Archived clients are considered (a returning customer is
// still "on the account") but a live one wins over an archived namesake.
export type ClientByNameMatch =
  | { status: 'found'; jobberClientId: string; name: string; address: string | null }
  | { status: 'ambiguous'; count: number }
  | { status: 'none' }

const nameTokens = (raw: string): string[] =>
  (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ''))
    .filter((t) => t.length >= 2)

export async function findClientByNameAndAddress(
  companyId: string,
  nameRaw: string,
  addressRaw?: string | null,
): Promise<ClientByNameMatch> {
  const tokens = nameTokens(nameRaw)
  if (!tokens.length) return { status: 'none' }
  const admin = createAdminClient()

  // Every token must appear somewhere in the name fields (so "Mary Evans" won't
  // match every Mary). Chained ilike filters AND together.
  let q = admin
    .from('clients')
    .select('id, external_id, name, first_name, last_name, company_name, is_archived')
    .eq('company_id', companyId)
    .eq('source', 'jobber')
    .is('deleted_at', null)
    .limit(25)
  for (const t of tokens) {
    const pat = `%${t.replace(/[%_]/g, '')}%`
    q = q.or(`name.ilike.${pat},first_name.ilike.${pat},last_name.ilike.${pat},company_name.ilike.${pat}`)
  }
  const { data } = await q
  type Row = { id: string; external_id: string | null; name: string | null; first_name: string | null; last_name: string | null; company_name: string | null; is_archived: boolean | null }
  const rows = ((data as Row[] | null) ?? []).filter((r) => r.external_id)
  if (!rows.length) return { status: 'none' }

  // Property addresses for the candidates, used both to disambiguate and to hand
  // back a confirmable address.
  const { data: props } = await admin
    .from('properties')
    .select('client_id, address_line1, city, zip, is_billing_address')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .in('client_id', rows.map((r) => r.id))
  type Prop = { client_id: string; address_line1: string | null; city: string | null; zip: string | null; is_billing_address: boolean | null }
  const propsByClient = new Map<string, Prop[]>()
  for (const p of (props as Prop[] | null) ?? []) {
    const list = propsByClient.get(p.client_id) ?? []
    list.push(p)
    propsByClient.set(p.client_id, list)
  }
  const displayAddress = (r: Row): string | null => {
    const list = [...(propsByClient.get(r.id) ?? [])].sort((a, b) => Number(b.is_billing_address) - Number(a.is_billing_address))
    const p = list[0]
    if (!p?.address_line1) return null
    return [p.address_line1, p.city, p.zip].filter(Boolean).join(', ')
  }

  // Address narrowing: the street number, or any street-name token, or the zip.
  let candidates = rows
  const addrTokens = nameTokens(addressRaw || '')
  if (addrTokens.length && candidates.length > 1) {
    const narrowed = candidates.filter((r) =>
      (propsByClient.get(r.id) ?? []).some((p) => {
        const hay = `${p.address_line1 || ''} ${p.city || ''} ${p.zip || ''}`.toLowerCase()
        return addrTokens.some((t) => hay.includes(t))
      }),
    )
    if (narrowed.length) candidates = narrowed
  }
  // A live client beats an archived namesake.
  const live = candidates.filter((r) => !r.is_archived)
  if (live.length) candidates = live

  if (candidates.length === 1) {
    const r = candidates[0]
    return {
      status: 'found',
      jobberClientId: r.external_id as string,
      name: clientDisplayName(r as ClientRow) || nameRaw,
      address: displayAddress(r),
    }
  }
  return { status: 'ambiguous', count: candidates.length }
}
