// Desktop Dialer Control — Session 4. Reverse phone-number lookup for screen-pop.
//
// Given an inbound/outbound E.164 number, match it against the mirrored Jobber
// `clients` (+ `properties` for the address) and the `txt_contacts` address book,
// returning a single best identity. The shared call state (use-twilio-device)
// caches this so the call bar, PiP, incoming popup, and notification all show the
// SAME identity from one query.
//
// Phone matching: both clients.phone and txt_contacts.phone are stored E.164
// (the Jobber sync normalizes with toE164; txt_contacts is validated to E.164 on
// write), so an exact-equality match is reliable. We also keep the last-10-digits
// in case a number carries a different country prefix.

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
async function addressForClient(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  clientId: string,
): Promise<string | null> {
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

const CLIENT_COLS =
  'id, external_id, name, first_name, last_name, company_name, is_lead, is_archived, balance, jobber_web_uri'

// Find a client by E.164 phone. Prefers a non-archived match when several exist.
async function clientByPhone(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  e164: string,
): Promise<ClientRow | null> {
  const { data } = await admin
    .from('clients')
    .select(CLIENT_COLS)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .eq('phone', e164)
    .order('is_archived', { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle()
  return (data as ClientRow) ?? null
}

async function clientByExternalId(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  externalId: string,
): Promise<ClientRow | null> {
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

async function enrichFromClient(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  c: ClientRow,
): Promise<Pick<DialerLookupMatch, 'status' | 'address' | 'clientId' | 'jobberClientId' | 'jobberWebUri' | 'balance'> & { name: string | null }> {
  return {
    name: clientDisplayName(c),
    status: clientStatus(c),
    address: await addressForClient(admin, companyId, c.id),
    clientId: c.id,
    jobberClientId: c.external_id,
    jobberWebUri: c.jobber_web_uri,
    balance: typeof c.balance === 'number' ? c.balance : null,
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

  // 1) txt_contacts (the texting address book) — exact E.164. If it links to a
  //    Jobber client, enrich with that client's status + address + deep-link.
  const { data: tc } = await admin
    .from('txt_contacts')
    .select('id, name, jobber_client_id')
    .eq('company_id', company)
    .eq('phone', e164)
    .limit(1)
    .maybeSingle()

  if (tc) {
    let enrichment: Awaited<ReturnType<typeof enrichFromClient>> | null = null
    if (tc.jobber_client_id) {
      const client = await clientByExternalId(admin, company, tc.jobber_client_id)
      if (client) enrichment = await enrichFromClient(admin, company, client)
    }
    return {
      source: 'txt_contact',
      name: (tc.name && tc.name.trim()) || enrichment?.name || null,
      phone: e164,
      status: enrichment?.status ?? null,
      address: enrichment?.address ?? null,
      clientId: enrichment?.clientId ?? null,
      jobberClientId: enrichment?.jobberClientId ?? tc.jobber_client_id ?? null,
      jobberWebUri: enrichment?.jobberWebUri ?? null,
      txtContactId: tc.id as string,
      balance: enrichment?.balance ?? null,
    }
  }

  // 2) clients (Jobber mirror) — exact E.164.
  const client = await clientByPhone(admin, company, e164)
  if (client) {
    const e = await enrichFromClient(admin, company, client)
    return {
      source: 'client',
      name: e.name,
      phone: e164,
      status: e.status,
      address: e.address,
      clientId: e.clientId,
      jobberClientId: e.jobberClientId,
      jobberWebUri: e.jobberWebUri,
      txtContactId: null,
      balance: e.balance,
    }
  }

  return null
}
