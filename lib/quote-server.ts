import { createAdminClient } from '@/lib/supabase/admin'
import { syncLeadToDirectory } from '@/lib/contacts-directory'
import type { QuoteItem } from '@/lib/quotes'

// Server helpers for Quotes (Work Orders & Quotes PRD — Phase 4). Every write
// goes through the service-role client after resolveQuoteCaller() has checked
// the caller's grant; every read is scoped by company_id here too.

type Admin = ReturnType<typeof createAdminClient>

export const QUOTE_COLS = 'id, contact_id, jobber_client_id, jobber_property_id, property_address, lawn_size_k, stop_id, lead_id, template_id, title, intro, terms, internal_notes, review_ids, deposit_type, deposit_value, status, sent_at, sent_via, expires_at, first_viewed_at, approved_at, approved_name, changes_message, total_required, total_selected, salesperson_user_id, jobber_quote_id, jobber_quote_number, jobber_web_uri, jobber_synced_at, jobber_sync_error, share_token, created_by, created_at, updated_at'
export const ITEM_COLS = 'id, sort_order, optional, recommended, jobber_product_id, pricer_ref, name, description, quantity, unit_price, taxable, selected_by_customer'

export type QuoteProperty = {
  /** Jobber property id (properties.external_id) — null for a property we only know by address. */
  jobberId: string | null
  address: string
  lawnK: number | null
  zones: number | null
}

export type QuoteContact = {
  id: string
  name: string
  phone: string | null
  email: string | null
  doNotText: boolean
  jobberClientId: string | null
}

const fullAddress = (p: { address_line1?: string | null; address_line2?: string | null; city?: string | null; state?: string | null; zip?: string | null }) =>
  [[p.address_line1, p.address_line2].filter(Boolean).join(', '), p.city, [p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')

export function contactDisplayName(c: { name?: string | null; first_name?: string | null; last_name?: string | null; company_name?: string | null; phone?: string | null }): string {
  return (c.name ?? '').trim()
    || [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
    || (c.company_name ?? '').trim()
    || c.phone
    || 'Customer'
}

/** The customer + their Jobber properties (with lawn size), for the builder. Null when not in this company. */
export async function loadQuoteCustomer(admin: Admin, companyId: string, contactId: string): Promise<{ contact: QuoteContact; properties: QuoteProperty[] } | null> {
  const { data: c } = await admin.from('txt_contacts')
    .select('id, name, first_name, last_name, company_name, phone, email, do_not_text, jobber_client_id, address_line1, address_line2, city, state, postal_code')
    .eq('company_id', companyId).eq('id', contactId).is('deleted_at', null).maybeSingle()
  if (!c) return null
  const contact: QuoteContact = {
    id: c.id as string,
    name: contactDisplayName(c),
    phone: (c.phone as string | null) ?? null,
    email: (c.email as string | null) ?? null,
    doNotText: !!c.do_not_text,
    jobberClientId: (c.jobber_client_id as string | null) ?? null,
  }
  const properties: QuoteProperty[] = []
  if (contact.jobberClientId) {
    const { data: client } = await admin.from('clients').select('id')
      .eq('company_id', companyId).eq('external_id', contact.jobberClientId).is('deleted_at', null).maybeSingle()
    if (client) {
      const { data: props } = await admin.from('properties')
        .select('external_id, address_line1, address_line2, city, state, zip, lawn_size_k, lawn_size_sqft, irrigation_zones')
        .eq('company_id', companyId).eq('client_id', client.id).is('deleted_at', null)
      for (const p of props ?? []) {
        const k = p.lawn_size_k != null ? Number(p.lawn_size_k) : p.lawn_size_sqft != null ? Number(p.lawn_size_sqft) / 1000 : null
        properties.push({
          jobberId: (p.external_id as string | null) ?? null,
          address: fullAddress(p),
          lawnK: k != null && Number.isFinite(k) && k > 0 ? Math.round(k * 10) / 10 : null,
          zones: p.irrigation_zones != null && Number(p.irrigation_zones) > 0 ? Number(p.irrigation_zones) : null,
        })
      }
    }
  }
  // A customer who isn't in Jobber yet (e.g. a new lead): use the directory address.
  if (!properties.length && c.address_line1) {
    properties.push({
      jobberId: null,
      address: fullAddress({ address_line1: c.address_line1, address_line2: c.address_line2, city: c.city, state: c.state, zip: c.postal_code }),
      lawnK: null,
      zones: null,
    })
  }
  return { contact, properties }
}

/** The property a stop is at: the client's property whose street matches the stop's address. */
export function propertyForAddress(properties: QuoteProperty[], address: string | null | undefined): QuoteProperty | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const street = norm((address ?? '').split(',')[0] ?? '')
  if (street) {
    const hit = properties.find(p => norm(p.address.split(',')[0] ?? '') === street)
      ?? properties.find(p => norm(p.address).startsWith(street))
    if (hit) return hit
  }
  return properties[0] ?? null
}

/**
 * A Lead Tracker card → its customer-file contact. Leads carry no contact id;
 * the directory links them by phone (last 10) then email — the same match the
 * Lead Tracker uses (syncLeadToDirectory), which also creates the contact when
 * the lead isn't in the directory yet.
 */
export async function contactForLead(admin: Admin, companyId: string, leadId: string): Promise<{ contactId: string; serviceAddress: string | null } | { error: string }> {
  const { data: lead } = await admin.from('leads')
    .select('id, first_name, last_name, phone, email, service_address')
    .eq('company_id', companyId).eq('id', leadId).maybeSingle()
  if (!lead) return { error: 'Lead not found' }
  const digits = String(lead.phone ?? '').replace(/\D/g, '')
  const ten = digits.length === 10 || digits.length === 11 ? digits.slice(-10) : null
  const email = (lead.email as string | null)?.trim() || null
  if (!ten && !email) return { error: 'This lead has no phone or email, so it can’t be matched to a customer — add one on the card first.' }
  const find = async () => {
    if (ten) {
      const { data } = await admin.from('txt_contacts').select('id')
        .eq('company_id', companyId).in('phone_digits', [ten, '1' + ten]).is('deleted_at', null).limit(1).maybeSingle()
      if (data) return data.id as string
    }
    if (email) {
      const { data } = await admin.from('txt_contacts').select('id')
        .eq('company_id', companyId).ilike('email', email).is('deleted_at', null).limit(1).maybeSingle()
      if (data) return data.id as string
    }
    return null
  }
  let contactId = await find()
  if (!contactId) {
    await syncLeadToDirectory(admin, companyId, {
      first_name: (lead.first_name as string | null) ?? null,
      last_name: (lead.last_name as string | null) ?? null,
      phone: (lead.phone as string | null) ?? null,
      email,
    })
    contactId = await find()
  }
  if (!contactId) return { error: 'Could not find or create a customer for this lead' }
  return { contactId, serviceAddress: (lead.service_address as string | null) ?? null }
}

/** Replace a quote's lines (drafts only — the caller checks). */
export async function replaceQuoteItems(admin: Admin, companyId: string, quoteId: string, items: (QuoteItem & { pricer_ref?: unknown; taxable?: boolean | null })[]): Promise<string | null> {
  const { error: delErr } = await admin.from('quote_line_items').delete().eq('quote_id', quoteId).eq('company_id', companyId)
  if (delErr) return delErr.message
  if (!items.length) return null
  const { error } = await admin.from('quote_line_items').insert(items.map((i, n) => ({
    quote_id: quoteId,
    company_id: companyId,
    sort_order: n,
    optional: !!i.optional,
    recommended: !!i.optional && !!i.recommended,
    jobber_product_id: i.jobber_product_id ?? null,
    pricer_ref: i.pricer_ref ?? null,
    name: i.name,
    description: i.description ?? '',
    quantity: i.quantity,
    unit_price: i.unit_price,
    taxable: i.taxable ?? null,
  })))
  return error ? error.message : null
}

/** Validate + trim builder lines from a request body. */
export function cleanQuoteItems(raw: unknown): (QuoteItem & { pricer_ref: Record<string, unknown> | null })[] | string {
  if (!Array.isArray(raw)) return 'Line items must be a list'
  const out: (QuoteItem & { pricer_ref: Record<string, unknown> | null })[] = []
  for (const r of raw.slice(0, 80)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, 200) : ''
    if (!name) continue
    const qty = Number(o.quantity)
    const pr = o.unit_price
    const price = pr === null || pr === '' || pr === undefined ? null : Number(pr)
    if (price !== null && (!Number.isFinite(price) || price < 0)) return `“${name}”: the price must be a number`
    out.push({
      name,
      description: typeof o.description === 'string' ? o.description.trim().slice(0, 4000) : '',
      quantity: Number.isFinite(qty) && qty > 0 ? Math.min(qty, 100000) : 1,
      unit_price: price === null ? null : Math.round(price * 100) / 100,
      optional: o.optional === true,
      recommended: o.optional === true && o.recommended === true,
      jobber_product_id: typeof o.jobber_product_id === 'string' && o.jobber_product_id ? o.jobber_product_id.slice(0, 200) : null,
      pricer_ref: o.pricer_ref && typeof o.pricer_ref === 'object' && !Array.isArray(o.pricer_ref) ? o.pricer_ref as Record<string, unknown> : null,
    })
  }
  return out
}
