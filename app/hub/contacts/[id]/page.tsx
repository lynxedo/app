import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CustomerDetailView from './CustomerDetailView'
import type {
  CustomerDetailAccount, CustomerDetailProperty,
  AccountProgram, AccountVisit, AccountLineItem,
} from './types'

// The CRM customer screen — one full page per contact. Reachable for every
// contact in the directory (2,000+). A Jobber-linked contact shows the rich
// account/property view; a lead/manual contact shows what it has and the
// account-derived sections stay quiet. Modeled on RealGreen's account page,
// adapted to our data + the Hub theme.

type CfMap = Record<string, string>

// Flatten Jobber's { label: { type, value } } custom-field object into
// label -> display string. Mirrors app/api/hub/reports/customers.
function flattenCf(raw: unknown): CfMap {
  const out: CfMap = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [label, v] of Object.entries(raw as Record<string, unknown>)) {
    let value = ''
    if (v && typeof v === 'object') {
      const r = v as Record<string, unknown>
      const inner = r.value
      if (r.type === 'CustomFieldArea' && inner && typeof inner === 'object') {
        const a = inner as Record<string, unknown>
        if (a.length != null || a.width != null) value = `${a.length ?? '?'} x ${a.width ?? '?'}`
      } else if (typeof inner === 'boolean') {
        value = inner ? 'Yes' : 'No'
      } else if (inner != null && inner !== '') {
        value = String(inner)
      }
    } else if (v != null && v !== '') {
      value = String(v)
    }
    out[label.trim()] = value
  }
  return out
}

// First non-empty value across the given (trimmed) keys.
function pick(cf: CfMap, ...keys: string[]): string {
  for (const k of keys) {
    const v = cf[k.trim()]
    if (v && v.trim() !== '') return v.trim()
  }
  return ''
}

function parseMoney(s: string): number | null {
  if (!s) return null
  const n = Number(s.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

// --- Program & services assembly (read-only, from the Jobber mirror) ---

function normName(s: string): string {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
}
// "WF - Root Rot Recovery" -> "Root Rot Recovery"
function stripDeptPrefix(name: string): string {
  const m = String(name || '').match(/^[A-Za-z]{2}\s*-\s*(.+)$/)
  return (m ? m[1] : String(name || '')).trim()
}

type JobRow = {
  id: string; title: string | null; dept_prefix: string | null; is_recurring: boolean | null
  job_status: string | null; total: number | null; jobber_web_uri: string | null
  start_at: string | null; completed_at: string | null
}
type LiRow = { parent_id: string; name: string | null; quantity: number | null; unit_price: number | null; total: number | null; dept_prefix: string | null }
type VRow = { id: string; job_id: string; scheduled_date: string | null; visit_status: string | null; completed_at: string | null; total: number | null }
type SvcDef = { prefix: string; name: string; color: string | null }
type ProgDef = { line_item_name: string; display_name: string | null; visits_per_year: number | null; is_auxiliary: boolean | null; dept_prefix: string | null }

function buildAccountPrograms(jobs: JobRow[], lineItems: LiRow[], visits: VRow[], svcDefs: SvcDef[], progDefs: ProgDef[]): AccountProgram[] {
  const defByName = new Map<string, ProgDef>()
  for (const d of progDefs) defByName.set(normName(d.line_item_name), d)
  const svcByPrefix = new Map<string, SvcDef>()
  for (const s of svcDefs) svcByPrefix.set(String(s.prefix).toUpperCase(), s)

  const liByJob = new Map<string, LiRow[]>()
  for (const li of lineItems) { const a = liByJob.get(li.parent_id) ?? []; a.push(li); liByJob.set(li.parent_id, a) }
  const vByJob = new Map<string, VRow[]>()
  for (const v of visits) { const a = vByJob.get(v.job_id) ?? []; a.push(v); vByJob.set(v.job_id, a) }

  const out: AccountProgram[] = []
  for (const j of jobs) {
    const lis = liByJob.get(j.id) ?? []
    const enriched = lis.map(li => {
      const def = defByName.get(normName(li.name || ''))
      return { li, def, isAux: !!(def && def.is_auxiliary) }
    })
    const bases = enriched.filter(e => !e.isAux)
    const baseWithDef = bases.find(e => e.def) ?? bases[0] ?? null

    const name =
      baseWithDef?.def?.display_name?.trim() ||
      (baseWithDef ? stripDeptPrefix(baseWithDef.li.name || '') : '') ||
      (j.title || '') || 'Service'

    const prefix =
      (j.dept_prefix || '').toUpperCase() ||
      (baseWithDef?.def?.dept_prefix || '').toUpperCase() ||
      (baseWithDef?.li?.dept_prefix || '').toUpperCase() ||
      (baseWithDef ? (String(baseWithDef.li.name || '').match(/^([A-Za-z]{2})\s*-/)?.[1] || '') : '').toUpperCase() ||
      ''
    const svc = prefix ? svcByPrefix.get(prefix) : undefined

    const jv = (vByJob.get(j.id) ?? []).slice().sort((a, b) => {
      const da = a.scheduled_date || '', db = b.scheduled_date || ''
      return da < db ? -1 : da > db ? 1 : 0
    })
    const roundByYear = new Map<number, number>()
    const avisits: AccountVisit[] = jv.map(v => {
      const year = v.scheduled_date ? Number(String(v.scheduled_date).slice(0, 4)) : null
      let round = 0
      if (year != null && !Number.isNaN(year)) { round = (roundByYear.get(year) ?? 0) + 1; roundByYear.set(year, round) }
      const status = String(v.visit_status || '')
      return {
        id: v.id, year: year != null && !Number.isNaN(year) ? year : null, round,
        date: v.scheduled_date ?? null, status,
        completed: !!v.completed_at || status.toUpperCase() === 'COMPLETED',
        total: v.total != null ? Number(v.total) : null,
      }
    })
    const latestDate = jv.length ? (jv[jv.length - 1].scheduled_date ?? null)
      : (j.completed_at || j.start_at || null)

    const lineItemsOut: AccountLineItem[] = enriched.map(e => ({
      name: stripDeptPrefix(e.li.name || ''),
      quantity: e.li.quantity != null ? Number(e.li.quantity) : null,
      unitPrice: e.li.unit_price != null ? Number(e.li.unit_price) : null,
      total: e.li.total != null ? Number(e.li.total) : null,
      isAux: e.isAux,
    }))

    out.push({
      id: j.id,
      isRecurring: !!j.is_recurring,
      category: prefix,
      categoryName: svc?.name || prefix || 'Other',
      categoryColor: svc?.color || null,
      name,
      jobStatus: String(j.job_status || ''),
      live: String(j.job_status || '') !== 'archived',
      visitsPerYear: baseWithDef?.def?.visits_per_year ?? null,
      jobTotal: j.total != null ? Number(j.total) : null,
      lineItems: lineItemsOut,
      visits: avisits,
      jobberWebUri: j.jobber_web_uri || '',
      latestDate,
    })
  }

  out.sort((a, b) => {
    if (a.isRecurring !== b.isRecurring) return a.isRecurring ? -1 : 1
    const da = a.latestDate || '', db = b.latestDate || ''
    return da < db ? 1 : da > db ? -1 : 0
  })
  return out
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_access_hub, can_access_dialer, can_access_txt, can_access_unified_inbox')
    .eq('id', user.id)
    .single()

  if (!profile?.can_access_hub) redirect('/hub')

  // The directory record (RLS scopes to the caller's company).
  const { data: raw } = await supabase
    .from('txt_contacts')
    .select(`
      id, company_id, name, name_source, first_name, last_name, company_name, is_company,
      phone, email, email_status, do_not_text, notes, jobber_client_id, sources, created_at,
      address_line1, address_line2, city, state, postal_code, country,
      tags:contact_tag_assignments(tag_id, contact_tags(id, label, color))
    `)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!raw) notFound()

  type RawTag = { tag_id: string; contact_tags: { id: string; label: string; color: string } | { id: string; label: string; color: string }[] | null }
  const rawTags = (raw.tags ?? []) as RawTag[]
  const tags = rawTags.flatMap(t => (Array.isArray(t.contact_tags) ? t.contact_tags : (t.contact_tags ? [t.contact_tags] : [])))

  const contact = {
    id: raw.id as string,
    name: raw.name as string,
    name_source: (raw.name_source as string | null) ?? null,
    first_name: (raw.first_name as string | null) ?? null,
    last_name: (raw.last_name as string | null) ?? null,
    company_name: (raw.company_name as string | null) ?? null,
    is_company: !!raw.is_company,
    phone: (raw.phone as string | null) ?? null,
    email: (raw.email as string | null) ?? null,
    email_status: (raw.email_status as string) ?? 'subscribed',
    do_not_text: !!raw.do_not_text,
    notes: (raw.notes as string | null) ?? null,
    jobber_client_id: (raw.jobber_client_id as string | null) ?? null,
    sources: (raw.sources as string[] | null) ?? [],
    created_at: raw.created_at as string,
    address_line1: (raw.address_line1 as string | null) ?? null,
    address_line2: (raw.address_line2 as string | null) ?? null,
    city: (raw.city as string | null) ?? null,
    state: (raw.state as string | null) ?? null,
    postal_code: (raw.postal_code as string | null) ?? null,
    country: (raw.country as string | null) ?? null,
    tags,
  }

  // All tags for the flag/tag editor.
  const { data: allTagsData } = await supabase
    .from('contact_tags')
    .select('id, label, color, sort_order')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })
  const allTags = (allTagsData ?? []).map(t => ({ id: t.id as string, label: t.label as string, color: t.color as string }))

  // The linked Jobber account (+ its properties) when this contact is a customer.
  let account: CustomerDetailAccount | null = null
  let properties: CustomerDetailProperty[] = []
  let programs: AccountProgram[] = []

  if (contact.jobber_client_id) {
    const { data: client } = await supabase
      .from('clients')
      .select('id, external_id, name, is_company, is_lead, is_archived, balance, lead_source, customer_since, sales_person, cancellation_reason, jobber_web_uri, custom_fields')
      .eq('company_id', profile.company_id!)
      .eq('external_id', contact.jobber_client_id)
      .is('deleted_at', null)
      .maybeSingle()

    if (client) {
      const clientCf = flattenCf(client.custom_fields)
      const status =
        client.is_lead ? 'Lead'
        : client.is_archived ? 'Archived'
        : (client.cancellation_reason && String(client.cancellation_reason).trim() !== '') ? 'Cancelled'
        : 'Active'

      account = {
        status,
        balance: client.balance != null ? Number(client.balance) : null,
        leadSource: (client.lead_source as string | null) || pick(clientCf, 'HLC105 Lead Source') || '',
        marketingSource: pick(clientCf, 'HLC Marketing Source - REQUIRED FIELD'),
        salesPerson: (client.sales_person as string | null) || pick(clientCf, 'Sales Person') || '',
        customerSince: (client.customer_since as string | null) || pick(clientCf, 'CFS[Customer Since Date]', 'Customer Since Date') || '',
        customerType: pick(clientCf, 'Customer Type') || (client.is_company ? 'Commercial' : 'Residential'),
        callAhead: pick(clientCf, 'Call Ahead'),
        irGold: pick(clientCf, 'IR GOLD?', 'CFS[IR GOLD?]'),
        cancellationReason: (client.cancellation_reason as string | null) || '',
        importedNote: pick(clientCf, 'NOTE:'),
        saPrepay: parseMoney(pick(clientCf, 'CFS[SA PrePay Balance]', 'SA PrePay Balance')),
        saRemit: parseMoney(pick(clientCf, 'CFS[SA Remit Balance]')),
        saBalance: parseMoney(pick(clientCf, 'CFS[SA Balance]', 'SA Balance')),
        jobberWebUri: (client.jobber_web_uri as string | null) || '',
      }

      const { data: propsData } = await supabase
        .from('properties')
        .select('id, address_line1, address_line2, city, state, zip, lawn_size_k, lawn_size_sqft, irrigation_zones, sprinkler_system, gate_code, neighborhood, jobber_web_uri, custom_fields')
        .eq('company_id', profile.company_id!)
        .eq('client_id', client.id)
        .is('deleted_at', null)

      properties = (propsData ?? []).map(p => {
        const pcf = flattenCf(p.custom_fields)
        const cf = { ...clientCf, ...Object.fromEntries(Object.entries(pcf).filter(([, v]) => v !== '')) }
        const lawnSqft = p.lawn_size_sqft != null ? Number(p.lawn_size_sqft) : (parseMoney(pick(cf, 'CFS[Lawn Size]')) ?? null)
        return {
          id: p.id as string,
          address: [p.address_line1, p.address_line2].filter(Boolean).join(', '),
          city: (p.city as string | null) || '',
          state: (p.state as string | null) || '',
          zip: (p.zip as string | null) || '',
          lawnSqft,
          lawnK: p.lawn_size_k != null ? Number(p.lawn_size_k) : null,
          irrigationZones: p.irrigation_zones != null ? Number(p.irrigation_zones) : (pick(cf, 'CFS[Irrigation Zones]') || ''),
          sprinkler: p.sprinkler_system == null ? (pick(cf, 'CFS[Sprinkler System]') || '') : (p.sprinkler_system ? 'Yes' : 'No'),
          gateCode: (p.gate_code as string | null) || '',
          neighborhood: (p.neighborhood as string | null) || pick(cf, 'Neighborhood') || '',
          directions: pick(cf, 'Directions'),
          jobberWebUri: (p.jobber_web_uri as string | null) || '',
        }
      })

      // No property row but the client carries RealGreen property data — surface
      // it as a single derived property card so it isn't lost.
      if (properties.length === 0) {
        const hasCfProp = pick(clientCf, 'CFS[Lawn Size]', 'CFS[Irrigation Zones]', 'Neighborhood', 'Directions')
        if (hasCfProp) {
          properties = [{
            id: 'client-cf',
            address: '',
            city: '', state: '', zip: '',
            lawnSqft: parseMoney(pick(clientCf, 'CFS[Lawn Size]')),
            lawnK: null,
            irrigationZones: pick(clientCf, 'CFS[Irrigation Zones]') || '',
            sprinkler: pick(clientCf, 'CFS[Sprinkler System]') || '',
            gateCode: '',
            neighborhood: pick(clientCf, 'Neighborhood') || '',
            directions: pick(clientCf, 'Directions'),
            jobberWebUri: '',
          }]
        }
      }

      // Programs (recurring jobs) + one-off services, from the synced Jobber mirror.
      const { data: jobRows } = await supabase
        .from('jobs')
        .select('id, title, dept_prefix, is_recurring, job_status, total, jobber_web_uri, start_at, completed_at')
        .eq('company_id', profile.company_id!)
        .eq('client_id', client.id)
        .is('deleted_at', null)

      const jobs = (jobRows ?? []) as JobRow[]
      const jobIds = jobs.map(j => j.id)
      if (jobIds.length > 0) {
        const [liRes, vRes, svcRes, progRes] = await Promise.all([
          supabase.from('line_items')
            .select('parent_id, name, quantity, unit_price, total, dept_prefix')
            .eq('company_id', profile.company_id!).eq('parent_type', 'job').in('parent_id', jobIds).is('deleted_at', null),
          supabase.from('visits')
            .select('id, job_id, scheduled_date, visit_status, completed_at, total')
            .eq('company_id', profile.company_id!).in('job_id', jobIds).is('deleted_at', null),
          supabase.from('service_definitions').select('prefix, name, color').eq('is_active', true),
          supabase.from('recurring_program_definitions').select('line_item_name, display_name, visits_per_year, is_auxiliary, dept_prefix'),
        ])
        programs = buildAccountPrograms(
          jobs,
          (liRes.data ?? []) as LiRow[],
          (vRes.data ?? []) as VRow[],
          (svcRes.data ?? []) as SvcDef[],
          (progRes.data ?? []) as ProgDef[],
        )
      }
    }
  }

  const currentYear = new Date().getFullYear()

  const canSeeActivity =
    profile.role === 'admin' ||
    profile.can_access_unified_inbox === true ||
    profile.can_access_txt === true

  return (
    <CustomerDetailView
      contact={contact}
      allTags={allTags}
      account={account}
      properties={properties}
      programs={programs}
      currentYear={currentYear}
      canAccessDialer={!!profile.can_access_dialer}
      canSeeActivity={canSeeActivity}
    />
  )
}
