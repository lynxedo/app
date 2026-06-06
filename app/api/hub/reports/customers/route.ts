import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/hub/reports/customers
// Returns the combined Customer report: clients ⨝ properties (one row per
// property, plus a row for clients with no property). Each row carries typed
// client + property columns and a flattened `cf` map of every custom field so
// the column-picker UI can surface any field on demand. Requires admin role.

type Json = Record<string, unknown>

const PAGE = 1000

// Pull every row from a table for the company, paging past PostgREST's 1000 cap.
async function fetchAll(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  columns: string,
  companyId: string,
): Promise<Json[]> {
  const out: Json[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    const batch = (data ?? []) as unknown as Json[]
    out.push(...batch)
    if (batch.length < PAGE) break
  }
  return out
}

// Flatten Jobber's { label: { type, value } } custom-field object into a map of
// label -> display string, and collect the set of every label seen.
function flattenCustomFields(
  cf: unknown,
  into: Record<string, string>,
  labelSet: Set<string>,
) {
  if (!cf || typeof cf !== 'object' || Array.isArray(cf)) return
  for (const [label, raw] of Object.entries(cf as Json)) {
    labelSet.add(label)
    let value = ''
    if (raw && typeof raw === 'object') {
      const r = raw as Json
      const v = r.value
      if (r.type === 'CustomFieldArea' && v && typeof v === 'object') {
        const a = v as Json
        if (a.length != null || a.width != null) value = `${a.length ?? '?'} x ${a.width ?? '?'}`
      } else if (typeof v === 'boolean') {
        value = v ? 'Yes' : 'No'
      } else if (v != null && v !== '') {
        value = String(v)
      }
    } else if (raw != null && raw !== '') {
      value = String(raw)
    }
    // Property values win over client values only when non-empty (caller merges
    // client first, property second).
    if (value !== '' || !(label in into)) into[label] = value
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  if (profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const [clients, properties] = await Promise.all([
      fetchAll(supabase, 'clients',
        'id, external_id, name, first_name, last_name, company_name, is_company, is_lead, is_archived, email, phone, balance, lead_source, customer_since, sales_person, cancellation_reason, jobber_web_uri, external_created_at, custom_fields',
        profile.company_id),
      fetchAll(supabase, 'properties',
        'id, client_id, name, address_line1, address_line2, city, state, zip, is_billing_address, lawn_size_k, lawn_size_sqft, irrigation_zones, sprinkler_system, gate_code, neighborhood, latitude, longitude, jobber_web_uri, custom_fields',
        profile.company_id),
    ])

    // Group properties by client_id.
    const propsByClient = new Map<string, Json[]>()
    for (const p of properties) {
      const cid = (p.client_id as string) ?? '__none__'
      const arr = propsByClient.get(cid) ?? []
      arr.push(p)
      propsByClient.set(cid, arr)
    }

    const labelSet = new Set<string>()
    const rows: Json[] = []

    const buildRow = (c: Json, p: Json | null) => {
      const cf: Record<string, string> = {}
      flattenCustomFields(c.custom_fields, cf, labelSet)   // client first
      if (p) flattenCustomFields(p.custom_fields, cf, labelSet) // property overrides non-empty

      const status =
        c.is_lead ? 'Lead'
        : c.is_archived ? 'Archived'
        : (c.cancellation_reason && String(c.cancellation_reason).trim() !== '') ? 'Cancelled'
        : 'Active'

      const addr = [p?.address_line1, p?.address_line2].filter(Boolean).join(', ')

      rows.push({
        client_id: c.id,
        property_id: p?.id ?? null,
        // Client typed
        customer: c.company_name || c.name || [c.first_name, c.last_name].filter(Boolean).join(' '),
        first_name: c.first_name ?? '',
        last_name: c.last_name ?? '',
        company_name: c.company_name ?? '',
        is_company: !!c.is_company,
        status,
        email: c.email ?? '',
        phone: c.phone ?? '',
        balance: c.balance ?? null,
        lead_source: c.lead_source ?? '',
        customer_since: c.customer_since ?? '',
        sales_person: c.sales_person ?? '',
        cancellation_reason: c.cancellation_reason ?? '',
        client_external_id: c.external_id ?? '',
        client_created_at: c.external_created_at ?? null,
        client_web_uri: c.jobber_web_uri ?? '',
        // Property typed
        address: addr,
        city: p?.city ?? '',
        state: p?.state ?? '',
        zip: p?.zip ?? '',
        property_name: p?.name ?? '',
        is_billing_address: p ? !!p.is_billing_address : null,
        lawn_size_sqft: p?.lawn_size_sqft ?? null,
        lawn_size_k: p?.lawn_size_k ?? null,
        irrigation_zones: p?.irrigation_zones ?? null,
        sprinkler_system: p ? (p.sprinkler_system == null ? null : !!p.sprinkler_system) : null,
        gate_code: p?.gate_code ?? '',
        neighborhood: p?.neighborhood ?? '',
        latitude: p?.latitude ?? null,
        longitude: p?.longitude ?? null,
        property_web_uri: p?.jobber_web_uri ?? '',
        cf,
      })
    }

    for (const c of clients) {
      const props = propsByClient.get(c.id as string)
      if (props && props.length) {
        for (const p of props) buildRow(c, p)
      } else {
        buildRow(c, null)
      }
    }

    return NextResponse.json({
      rows,
      customFieldLabels: [...labelSet].sort((a, b) => a.localeCompare(b)),
      counts: { clients: clients.length, properties: properties.length, rows: rows.length },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
