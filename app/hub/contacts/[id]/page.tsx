import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CustomerDetailView from './CustomerDetailView'
import type { CustomerDetailAccount, CustomerDetailProperty } from './types'

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
      id, company_id, name, first_name, last_name, company_name, is_company,
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
    }
  }

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
      canAccessDialer={!!profile.can_access_dialer}
      canSeeActivity={canSeeActivity}
    />
  )
}
