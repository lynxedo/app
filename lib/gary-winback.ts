// Gary's win-back list — PREVIEW ONLY (session 1, Oct 15 2026). Nothing here
// sends anything; it answers "who would Gary contact, why, and how?"
//
// Who's on it:
//   • dead leads  — Lead Tracker leads in Closed Lost / Closed Other / Follow Up —
//                   Long Term (minus Bad Lead / Duplicate / Did Not Bid)
//   • unwon quotes — Jobber quotes archived or still awaiting a response
// One person who is both (same phone or email) is ONE row with both reasons.
//
// Who's skipped, and why (each skipped row says which rule):
//   • not a Gary service (mowing / pet waste / nothing recorded / switched off)
//   • already a customer for that service, or bought it after the lead / quote
//   • a quote still awaiting an answer and sent under 30 days ago
//   • in an active Drip campaign, or Amber is mid-conversation with them
//   • talked with us (text, call or email) within settings.recentTouchDays
//   • no way to reach them
//
// Channel (Ben, Oct 15 2026): email by default; a TEXT only when we have texted
// this person before from Txt and they're not marked Do Not Text; phone-only
// people go on a CALL list for a person (Gary never calls).
//
// Every read is company-scoped and paginated past PostgREST's 1000-row cap; a
// failed read throws rather than silently shrinking the list (a skipped "already
// a customer" check would put real customers on it).

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  GARY_SERVICE_DEPT,
  GARY_SERVICE_LABEL,
  readServices,
  type GaryService,
  type GarySettings,
} from '@/lib/gary'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>

export type WinbackChannel = 'text' | 'email' | 'call'
export type WinbackSkip =
  | 'gary_waiting'
  | 'gary_emailed'
  | 'gary_turned_down'
  | 'pet_waste_only'
  | 'no_service'
  | 'not_gary_service'
  | 'service_off'
  | 'customer_now'
  | 'bought_after'
  | 'quote_fresh'
  | 'in_drip'
  | 'amber_working'
  | 'recent_touch'
  | 'no_way_to_reach'

export const WINBACK_SKIP_LABEL: Record<WinbackSkip, string> = {
  gary_waiting: 'Gary’s email is waiting for approval',
  gary_emailed: 'Gary already emailed them',
  gary_turned_down: 'A person turned down Gary’s email',
  pet_waste_only: 'Pet waste only',
  no_service: 'No service recorded',
  not_gary_service: 'Not a Gary service',
  service_off: 'Service switched off for Gary',
  customer_now: 'Already a customer for this',
  bought_after: 'Bought this later',
  quote_fresh: 'Quote sent under 30 days ago',
  in_drip: 'In a Drip campaign',
  amber_working: 'Amber is texting with them',
  recent_touch: 'Talked with us recently',
  no_way_to_reach: 'No way to reach them',
}

export type WinbackSource = {
  kind: 'lead' | 'quote'
  id: string
  /** e.g. "Asked about IRR SC · Not Sold — Other" or "Quote #412 “Irrigation Install” · no answer" */
  detail: string
  date: string | null
  link: string | null
}

export type WinbackRow = {
  key: string
  name: string
  contactId: string | null
  phone: string | null
  email: string | null
  services: GaryService[]
  sources: WinbackSource[]
  channel: WinbackChannel | null
  /** Why this channel, in a few words ("texted before", "never texted", …). */
  channelNote: string
  skip: WinbackSkip | null
  skipDetail: string | null
  lastTouchAt: string | null
}

export type WinbackPreview = {
  generatedAt: string
  recentTouchDays: number
  rows: WinbackRow[]
  counts: {
    people: number
    ready: number
    byChannel: Record<WinbackChannel, number>
    bySkip: Partial<Record<WinbackSkip, number>>
    fromLeads: number
    fromQuotes: number
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readAll<T>(label: string, build: () => any, pageSize = 1000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error) throw new Error(`${label}: ${error.message}`)
    const page = (data ?? []) as T[]
    out.push(...page)
    if (page.length < pageSize) return out
  }
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Last 10 digits — every phone key in this file goes through here. */
function p10(v: string | null | undefined): string | null {
  const d = (v || '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}

function em(v: string | null | undefined): string | null {
  const e = (v || '').trim().toLowerCase()
  return e.includes('@') ? e : null
}

function later(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

function shortDate(iso: string | null): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(iso),
  )
}

const DEAD_STAGES = ['closed_lost', 'closed_other', 'follow_up_long_term']
const NOT_A_REAL_LEAD = /bad\s*lead|duplicate|did\s*not\s*bid/i
const FRESH_QUOTE_DAYS = 30

type LeadRow = {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  service: string[] | null
  status: string | null
  stage: string | null
  lead_creation_date: string | null
  created_at: string
}
type QuoteRow = {
  id: string
  client_external_id: string | null
  quote_number: number | null
  title: string | null
  quote_status: string
  sent_at: string | null
  service_codes: string[] | null
  external_created_at: string | null
  jobber_web_uri: string | null
}
type ClientRow = {
  external_id: string
  name: string | null
  first_name: string | null
  last_name: string | null
  company_name: string | null
  email: string | null
  phone: string | null
  phone_digits_all: string[] | null
}
type ContactRow = {
  id: string
  name: string | null
  phone_digits: string | null
  email: string | null
  do_not_text: boolean | null
  do_not_call: boolean | null
  jobber_client_id: string | null
}
type JobRow = { client_external_id: string | null; dept_prefix: string | null; job_status: string | null; external_created_at: string | null }

type Person = {
  key: string
  name: string
  phone10: string | null
  phone: string | null
  email: string | null
  clientExternalIds: Set<string>
  sources: (WinbackSource & { serviceText: string[]; deptCodes: string[]; quoteStatus?: string })[]
  leadIds: string[]
}

// ── the builder ────────────────────────────────────────────────────────────

export async function buildWinbackPreview(
  admin: Admin,
  companyId: string,
  settings: GarySettings,
  // ignoreQueueId: at approval time the message being approved must not count as
  //   "Gary already wrote".
  // followUps: judging a FOLLOW-UP — Gary having written already is expected, so
  //   the gary_* skips don't apply (every other rule still does).
  opts: { ignoreQueueId?: string; followUps?: boolean } = {},
): Promise<WinbackPreview> {
  const now = Date.now()
  const since = new Date(now - settings.recentTouchDays * 86_400_000).toISOString()

  const [leads, quotes, allQuotes, clients, contacts, jobs, suppressions, garyItems] = await Promise.all([
    readAll<LeadRow>('leads', () =>
      admin
        .from('leads')
        .select('id, first_name, last_name, phone, email, service, status, stage, lead_creation_date, created_at')
        .eq('company_id', companyId)
        .in('stage', DEAD_STAGES)
        .order('id'),
    ),
    readAll<QuoteRow>('jobber_quotes', () =>
      admin
        .from('jobber_quotes')
        .select('id, client_external_id, quote_number, title, quote_status, sent_at, service_codes, external_created_at, jobber_web_uri')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .in('quote_status', ['archived', 'awaiting_response'])
        .order('id'),
    ),
    readAll<{ client_external_id: string | null; quote_status: string; service_codes: string[] | null; converted_at: string | null; approved_at: string | null }>(
      'jobber_quotes (won)',
      () =>
        admin
          .from('jobber_quotes')
          .select('client_external_id, quote_status, service_codes, converted_at, approved_at')
          .eq('company_id', companyId)
          .is('deleted_at', null)
          .in('quote_status', ['converted', 'approved'])
          .order('id'),
    ),
    readAll<ClientRow>('clients', () =>
      admin
        .from('clients')
        .select('external_id, name, first_name, last_name, company_name, email, phone, phone_digits_all')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .order('id'),
    ),
    readAll<ContactRow>('txt_contacts', () =>
      admin
        .from('txt_contacts')
        .select('id, name, phone_digits, email, do_not_text, do_not_call, jobber_client_id')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .order('id'),
    ),
    readAll<JobRow>('jobs', () =>
      admin
        .from('jobs')
        .select('client_external_id, dept_prefix, job_status, external_created_at')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .order('id'),
    ),
    readAll<{ email: string }>('email_suppressions', () =>
      admin.from('email_suppressions').select('email').eq('company_id', companyId).order('id'),
    ),
    // Gary's own emails — waiting, sent, or turned down by a person. Expired,
    // failed and withdrawn ones don't count: nothing reached the customer.
    readAll<{ id: string; person_key: string; to_email: string | null; status: string; sent_at: string | null; decided_at: string | null; inbox_thread_id: string | null }>(
      'gary_queue',
      () =>
        admin
          .from('gary_queue')
          .select('id, person_key, to_email, status, sent_at, decided_at, inbox_thread_id')
          .eq('company_id', companyId)
          .in('status', ['pending', 'sending', 'sent', 'rejected'])
          .order('id'),
    ),
  ])

  // Indexes
  const clientByExt = new Map<string, ClientRow>()
  const clientsByPhone = new Map<string, ClientRow[]>()
  const clientsByEmail = new Map<string, ClientRow[]>()
  for (const c of clients) {
    clientByExt.set(c.external_id, c)
    const phones = new Set<string>()
    for (const d of c.phone_digits_all ?? []) {
      const k = p10(d)
      if (k) phones.add(k)
    }
    const k = p10(c.phone)
    if (k) phones.add(k)
    for (const ph of phones) clientsByPhone.set(ph, [...(clientsByPhone.get(ph) ?? []), c])
    const e = em(c.email)
    if (e) clientsByEmail.set(e, [...(clientsByEmail.get(e) ?? []), c])
  }
  const contactByPhone = new Map<string, ContactRow>()
  const contactByClient = new Map<string, ContactRow>()
  const contactByEmail = new Map<string, ContactRow>()
  for (const c of contacts) {
    const k = p10(c.phone_digits)
    if (k && !contactByPhone.has(k)) contactByPhone.set(k, c)
    if (c.jobber_client_id && !contactByClient.has(c.jobber_client_id)) contactByClient.set(c.jobber_client_id, c)
    const e = em(c.email)
    if (e && !contactByEmail.has(e)) contactByEmail.set(e, c)
  }
  const jobsByClient = new Map<string, JobRow[]>()
  for (const j of jobs) {
    if (!j.client_external_id) continue
    jobsByClient.set(j.client_external_id, [...(jobsByClient.get(j.client_external_id) ?? []), j])
  }
  const wonByClient = new Map<string, typeof allQuotes>()
  for (const q of allQuotes) {
    if (!q.client_external_id) continue
    wonByClient.set(q.client_external_id, [...(wonByClient.get(q.client_external_id) ?? []), q])
  }
  const suppressed = new Set(suppressions.map((s) => em(s.email)).filter(Boolean) as string[])
  // Strongest state wins: waiting > sent > turned down. Matched by person key AND
  // by address, so a person whose key changes (a phone added later) is still known.
  const GARY_RANK: Record<string, number> = { pending: 3, sending: 3, sent: 2, rejected: 1 }
  const garyByKey = new Map<string, (typeof garyItems)[number]>()
  const garyByEmail = new Map<string, (typeof garyItems)[number]>()
  for (const g of garyItems) {
    if (g.id === opts.ignoreQueueId) continue
    const k = garyByKey.get(g.person_key)
    if (!k || GARY_RANK[g.status] > GARY_RANK[k.status]) garyByKey.set(g.person_key, g)
    const e = em(g.to_email)
    if (e) {
      const prev = garyByEmail.get(e)
      if (!prev || GARY_RANK[g.status] > GARY_RANK[prev.status]) garyByEmail.set(e, g)
    }
  }

  // ── gather people ──
  const people = new Map<string, Person>()
  const keyIndex = new Map<string, string>() // phone10 / email / client:ext → person key

  function personFor(phone10: string | null, email: string | null, clientExt: string | null, name: string, phone: string | null): Person {
    const lookups = [phone10 && `p:${phone10}`, email && `e:${email}`, clientExt && `c:${clientExt}`].filter(Boolean) as string[]
    let key = lookups.map((l) => keyIndex.get(l)).find(Boolean)
    if (!key) key = lookups[0] ?? `anon:${people.size}`
    let p = people.get(key)
    if (!p) {
      p = { key, name, phone10, phone, email, clientExternalIds: new Set(), sources: [], leadIds: [] }
      people.set(key, p)
    }
    for (const l of lookups) keyIndex.set(l, key)
    if (!p.phone10 && phone10) {
      p.phone10 = phone10
      p.phone = phone
    }
    if (!p.email && email) p.email = email
    if ((!p.name || p.name === '(no name)') && name) p.name = name
    if (clientExt) p.clientExternalIds.add(clientExt)
    return p
  }

  let fromLeads = 0
  for (const l of leads) {
    if (NOT_A_REAL_LEAD.test(l.status || '')) continue
    fromLeads++
    const phone10 = p10(l.phone)
    const email = em(l.email)
    const name = [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || '(no name)'
    const p = personFor(phone10, email, null, name, l.phone)
    // Link the Jobber client(s) this lead became, by phone or email.
    for (const c of [...(phone10 ? clientsByPhone.get(phone10) ?? [] : []), ...(email ? clientsByEmail.get(email) ?? [] : [])]) {
      p.clientExternalIds.add(c.external_id)
    }
    const services = (l.service ?? []).filter(Boolean)
    const date = l.lead_creation_date || l.created_at
    p.leadIds.push(l.id)
    p.sources.push({
      kind: 'lead',
      id: l.id,
      detail: `Asked about ${services.length ? services.join(', ') : '(nothing recorded)'}${l.status ? ` · ${l.status}` : ''}`,
      date,
      link: null,
      serviceText: services,
      deptCodes: [],
    })
  }

  for (const q of quotes) {
    const c = q.client_external_id ? clientByExt.get(q.client_external_id) : undefined
    const phone10 = p10(c?.phone) ?? (c?.phone_digits_all ?? []).map(p10).find(Boolean) ?? null
    const email = em(c?.email)
    const name =
      (c && (c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.name)) || '(no name)'
    const p = personFor(phone10, email, q.client_external_id, name, c?.phone ?? null)
    const date = q.sent_at || q.external_created_at
    const status = q.quote_status === 'awaiting_response' ? 'no answer yet' : 'archived'
    p.sources.push({
      kind: 'quote',
      id: q.id,
      detail: `Quote${q.quote_number ? ` #${q.quote_number}` : ''}${q.title?.trim() ? ` “${q.title.trim()}”` : ''} · ${status}`,
      date,
      link: q.jobber_web_uri,
      serviceText: [q.title || ''],
      deptCodes: q.service_codes ?? [],
      quoteStatus: q.quote_status,
    })
  }

  // ── resolve each person's Txt contact ──
  const personContact = new Map<string, ContactRow>()
  for (const p of people.values()) {
    let c: ContactRow | undefined = p.phone10 ? contactByPhone.get(p.phone10) : undefined
    if (!c) for (const ext of p.clientExternalIds) if ((c = contactByClient.get(ext))) break
    if (!c && p.email) c = contactByEmail.get(p.email)
    if (c) personContact.set(p.key, c)
  }
  const contactIds = [...new Set([...personContact.values()].map((c) => c.id))]
  const phoneSet = new Set([...people.values()].map((p) => p.phone10).filter(Boolean) as string[])
  const emailSet = new Set([...people.values()].map((p) => p.email).filter(Boolean) as string[])
  const leadIdSet = new Set([...people.values()].flatMap((p) => p.leadIds))

  // ── activity reads (scoped to these people where the API allows) ──
  const textedBefore = new Set<string>() // contact ids we've sent an outbound text to
  const lastTextAt = new Map<string, string>() // contact id → latest text either way, within the window
  for (const ids of chunks(contactIds, 100)) {
    const out = await readAll<{ contact_id: string }>('txt_messages (history)', () =>
      admin.from('txt_messages').select('contact_id').eq('company_id', companyId).eq('direction', 'outbound').in('contact_id', ids).order('id'),
    )
    for (const m of out) textedBefore.add(m.contact_id)
    const recent = await readAll<{ contact_id: string; created_at: string; sent_by: string | null }>('txt_messages (recent)', () =>
      admin
        .from('txt_messages')
        .select('contact_id, created_at, sent_by')
        .eq('company_id', companyId)
        .in('contact_id', ids)
        .gte('created_at', since)
        .order('id'),
    )
    for (const m of recent) {
      // Gary's own texts aren't "a person talked with them" — they'd block his follow-ups.
      if (settings.botUserId && m.sent_by === settings.botUserId) continue
      lastTextAt.set(m.contact_id, later(lastTextAt.get(m.contact_id) ?? null, m.created_at) as string)
    }
  }

  const recentCalls = await readAll<{ contact_id: string | null; from_number: string | null; to_number: string | null; created_at: string }>(
    'calls',
    () =>
      admin
        .from('calls')
        .select('contact_id, from_number, to_number, created_at')
        .eq('company_id', companyId)
        .gte('created_at', since)
        .order('id'),
  )
  const lastCallByPhone = new Map<string, string>()
  const lastCallByContact = new Map<string, string>()
  for (const c of recentCalls) {
    for (const n of [p10(c.from_number), p10(c.to_number)]) {
      if (n && phoneSet.has(n)) lastCallByPhone.set(n, later(lastCallByPhone.get(n) ?? null, c.created_at) as string)
    }
    if (c.contact_id) lastCallByContact.set(c.contact_id, later(lastCallByContact.get(c.contact_id) ?? null, c.created_at) as string)
  }

  // Threads Gary started don't count either. A reply on one is caught by
  // lib/gary-replies.ts (replied_at), which stops his follow-ups on its own.
  const garyThreads = new Set(garyItems.map((g) => g.inbox_thread_id).filter(Boolean) as string[])
  const recentThreads = await readAll<{ id: string; from_email: string | null; participants: { email?: string }[] | null; last_message_at: string }>(
    'inbox_threads',
    () =>
      admin
        .from('inbox_threads')
        .select('id, from_email, participants, last_message_at')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .gte('last_message_at', since)
        .order('id'),
  )
  const lastEmailAt = new Map<string, string>()
  for (const t of recentThreads) {
    if (garyThreads.has(t.id)) continue
    const addrs = new Set<string>()
    const f = em(t.from_email)
    if (f) addrs.add(f)
    for (const pt of Array.isArray(t.participants) ? t.participants : []) {
      const e = em(pt?.email)
      if (e) addrs.add(e)
    }
    for (const e of addrs) if (emailSet.has(e)) lastEmailAt.set(e, later(lastEmailAt.get(e) ?? null, t.last_message_at) as string)
  }

  const drips = await readAll<{ lead_id: string | null; contact_id: string | null; phone_digits: string | null }>('drip_enrollments', () =>
    admin
      .from('drip_enrollments')
      .select('lead_id, contact_id, phone_digits')
      .eq('company_id', companyId)
      .in('status', ['active', 'paused'])
      .order('id'),
  )
  const dripLeads = new Set(drips.map((d) => d.lead_id).filter((x): x is string => !!x && leadIdSet.has(x)))
  const dripContacts = new Set(drips.map((d) => d.contact_id).filter(Boolean) as string[])
  const dripPhones = new Set(drips.map((d) => p10(d.phone_digits)).filter(Boolean) as string[])

  const amberThreads = await readAll<{ conversation_id: string }>('amber_text_threads', () =>
    admin.from('amber_text_threads').select('conversation_id').eq('company_id', companyId).eq('status', 'active').order('id'),
  )
  const amberContacts = new Set<string>()
  for (const ids of chunks(amberThreads.map((t) => t.conversation_id), 100)) {
    const convs = await readAll<{ contact_id: string | null }>('txt_conversations', () =>
      admin.from('txt_conversations').select('contact_id').eq('company_id', companyId).in('id', ids).order('id'),
    )
    for (const c of convs) if (c.contact_id) amberContacts.add(c.contact_id)
  }

  // ── decide each person ──
  const rows: WinbackRow[] = []
  const freshCutoff = new Date(now - FRESH_QUOTE_DAYS * 86_400_000).toISOString()
  const allowed = new Set(settings.services)

  for (const p of people.values()) {
    const contact = personContact.get(p.key) ?? null
    p.sources.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    const earliest = p.sources.map((s) => s.date).filter(Boolean).sort()[0] ?? null

    // What they asked about, across every source.
    const read = readServices(
      p.sources.flatMap((s) => s.serviceText),
      p.sources.flatMap((s) => s.deptCodes),
    )
    let services = read.services

    const row: WinbackRow = {
      key: p.key,
      name: p.name,
      contactId: contact?.id ?? null,
      phone: p.phone,
      email: p.email,
      services,
      sources: p.sources.map(({ kind, id, detail, date, link }) => ({ kind, id, detail, date, link })),
      channel: null,
      channelNote: '',
      skip: null,
      skipDetail: null,
      lastTouchAt: null,
    }
    const skip = (why: WinbackSkip, detail: string | null = null) => {
      row.skip = why
      row.skipDetail = detail
      rows.push(row)
    }

    const fromKey = garyByKey.get(p.key)
    const fromEmail = p.email ? garyByEmail.get(p.email) : undefined
    const gary = [fromKey, fromEmail].filter(Boolean).sort((a, b) => GARY_RANK[b!.status] - GARY_RANK[a!.status])[0]
    if (gary && !opts.followUps) {
      if (gary.status === 'pending' || gary.status === 'sending') skip('gary_waiting')
      else if (gary.status === 'sent') skip('gary_emailed', shortDate(gary.sent_at))
      else skip('gary_turned_down', shortDate(gary.decided_at))
      continue
    }

    if (services.length === 0) {
      const anyText = p.sources.some((s) => s.serviceText.some((t) => t.trim()) || s.deptCodes.length)
      if (read.excluded.includes('pet_waste')) skip('pet_waste_only')
      else if (!anyText) skip('no_service')
      else skip('not_gary_service', read.excluded.includes('mowing') ? 'Mowing' : null)
      continue
    }
    services = services.filter((s) => allowed.has(s))
    row.services = services
    if (services.length === 0) {
      skip('service_off', read.services.map((s) => GARY_SERVICE_LABEL[s]).join(', '))
      continue
    }

    // Customers: drop services they already have (an open job in that department),
    // and skip anyone who bought that service after first asking.
    const clientJobs = [...p.clientExternalIds].flatMap((ext) => jobsByClient.get(ext) ?? [])
    const clientWins = [...p.clientExternalIds].flatMap((ext) => wonByClient.get(ext) ?? [])
    const has = (s: GaryService) =>
      clientJobs.some((j) => j.dept_prefix === GARY_SERVICE_DEPT[s] && j.job_status && j.job_status !== 'archived')
    const boughtAfter = (s: GaryService) =>
      !!earliest &&
      (clientJobs.some((j) => j.dept_prefix === GARY_SERVICE_DEPT[s] && (j.external_created_at || '') > earliest) ||
        clientWins.some(
          (q) => (q.service_codes ?? []).includes(GARY_SERVICE_DEPT[s]) && (q.converted_at || q.approved_at || '') > earliest,
        ))
    const customerFor = services.filter(has)
    services = services.filter((s) => !has(s))
    row.services = services
    if (services.length === 0) {
      skip('customer_now', customerFor.map((s) => GARY_SERVICE_LABEL[s]).join(', '))
      continue
    }
    const bought = services.filter(boughtAfter)
    services = services.filter((s) => !boughtAfter(s))
    row.services = services
    if (services.length === 0) {
      skip('bought_after', bought.map((s) => GARY_SERVICE_LABEL[s]).join(', '))
      continue
    }

    const fresh = p.sources.find(
      (s) => s.kind === 'quote' && s.quoteStatus === 'awaiting_response' && (s.date || '') > freshCutoff,
    )
    if (fresh) {
      skip('quote_fresh', `Sent ${shortDate(fresh.date)}`)
      continue
    }

    if (p.leadIds.some((id) => dripLeads.has(id)) || (contact && dripContacts.has(contact.id)) || (p.phone10 && dripPhones.has(p.phone10))) {
      skip('in_drip')
      continue
    }
    if (contact && amberContacts.has(contact.id)) {
      skip('amber_working')
      continue
    }

    const lastTouch = [
      contact ? lastTextAt.get(contact.id) ?? null : null,
      contact ? lastCallByContact.get(contact.id) ?? null : null,
      p.phone10 ? lastCallByPhone.get(p.phone10) ?? null : null,
      p.email ? lastEmailAt.get(p.email) ?? null : null,
    ].reduce<string | null>((a, b) => later(a, b), null)
    row.lastTouchAt = lastTouch
    if (lastTouch) {
      skip('recent_touch', shortDate(lastTouch))
      continue
    }

    // Channel.
    const canText = !!p.phone10 && !!contact && textedBefore.has(contact.id) && !contact.do_not_text
    const canEmail = !!p.email && !suppressed.has(p.email)
    if (canText) {
      row.channel = 'text'
      row.channelNote = canEmail ? 'Texted before · email as backup' : 'Texted before'
    } else if (canEmail) {
      row.channel = 'email'
      row.channelNote = !p.phone10
        ? 'No phone'
        : contact?.do_not_text
          ? 'Marked Do Not Text'
          : 'Never texted from Txt'
    } else if (p.phone10 && !contact?.do_not_call) {
      row.channel = 'call'
      row.channelNote = p.email ? 'Email unsubscribed or bounced, never texted' : 'No email, never texted'
    } else {
      skip('no_way_to_reach', contact?.do_not_call ? 'Do Not Call, no usable email' : null)
      continue
    }
    rows.push(row)
  }

  rows.sort((a, b) => {
    if (!!a.skip !== !!b.skip) return a.skip ? 1 : -1
    return (b.sources[0]?.date || '').localeCompare(a.sources[0]?.date || '')
  })

  const byChannel: Record<WinbackChannel, number> = { text: 0, email: 0, call: 0 }
  const bySkip: Partial<Record<WinbackSkip, number>> = {}
  for (const r of rows) {
    if (r.skip) bySkip[r.skip] = (bySkip[r.skip] ?? 0) + 1
    else if (r.channel) byChannel[r.channel]++
  }

  return {
    generatedAt: new Date(now).toISOString(),
    recentTouchDays: settings.recentTouchDays,
    rows,
    counts: {
      people: rows.length,
      ready: rows.filter((r) => !r.skip).length,
      byChannel,
      bySkip,
      fromLeads,
      fromQuotes: quotes.length,
    },
  }
}
