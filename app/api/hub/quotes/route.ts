import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveQuoteCaller } from '@/lib/quote-access'
import { contactDisplayName, contactForLead, loadQuoteCustomer, propertyForAddress, replaceQuoteItems } from '@/lib/quote-server'
import { quoteTotals, type QuoteItem, type TemplateItem } from '@/lib/quotes'

// Quotes (Work Orders & Quotes PRD — Phase 4, session 3: the builder).
//   GET  ?contactId=&status=  → { quotes }   newest first (max 200)
//   POST { contactId? | stopId? | leadId?, templateId? } → { id }
//        Starts a DRAFT for the customer — from a customer file, a work-order
//        stop (its customer + the property at the stop's address) or a Lead
//        Tracker card (matched to the directory by phone/email) — copying the
//        template when one is picked (a later template edit never changes it).
// Anyone who can build quotes (can_access_quotes / Quotes admin / admin).

export async function GET(request: NextRequest) {
  const c = await resolveQuoteCaller('use')
  if ('error' in c) return c.error
  const sp = request.nextUrl.searchParams
  let q = createAdminClient().from('quotes')
    .select('id, contact_id, title, status, property_address, total_required, total_selected, sent_at, expires_at, approved_at, created_by, updated_at, contact:txt_contacts!contact_id(name, first_name, last_name, company_name, phone)')
    .eq('company_id', c.companyId).is('deleted_at', null)
  const contactId = sp.get('contactId')
  if (contactId) q = q.eq('contact_id', contactId)
  const status = sp.get('status')
  if (status) q = q.eq('status', status)
  const { data, error } = await q.order('updated_at', { ascending: false }).limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    quotes: (data ?? []).map(r => {
      const contact = (Array.isArray(r.contact) ? r.contact[0] : r.contact) as Parameters<typeof contactDisplayName>[0] | null
      const { contact: _drop, ...rest } = r
      void _drop
      return { ...rest, customer_name: contact ? contactDisplayName(contact) : '' }
    }),
  })
}

export async function POST(request: NextRequest) {
  const c = await resolveQuoteCaller('use')
  if ('error' in c) return c.error
  const admin = createAdminClient()
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

  let contactId = str(body.contactId)
  const stopId = str(body.stopId)
  const leadId = str(body.leadId)
  let atAddress: string | null = null

  if (stopId) {
    const { data: stop } = await admin.from('daily_log_stops')
      .select('id, contact_id, address, entry:daily_log_entries!entry_id(company_id)')
      .eq('id', stopId).maybeSingle()
    const entry = (Array.isArray(stop?.entry) ? stop?.entry[0] : stop?.entry) as { company_id: string } | null | undefined
    if (!stop || entry?.company_id !== c.companyId) return NextResponse.json({ error: 'Stop not found' }, { status: 404 })
    if (!stop.contact_id) return NextResponse.json({ error: 'This stop isn’t linked to a customer file yet, so a quote can’t be started from it.' }, { status: 400 })
    contactId = stop.contact_id as string
    atAddress = (stop.address as string | null) ?? null
  } else if (leadId) {
    const r = await contactForLead(admin, c.companyId, leadId)
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
    contactId = r.contactId
    atAddress = r.serviceAddress
  }
  if (!contactId) return NextResponse.json({ error: 'Pick a customer first' }, { status: 400 })

  const customer = await loadQuoteCustomer(admin, c.companyId, contactId)
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  const property = propertyForAddress(customer.properties, atAddress)

  type TemplateRow = { id: string; title: string; intro: string; terms: string; default_items: TemplateItem[]; default_review_ids: string[]; deposit_type: string | null; deposit_value: number | null }
  let template: TemplateRow | null = null
  const templateId = str(body.templateId)
  if (templateId) {
    const { data } = await admin.from('quote_templates')
      .select('id, title, intro, terms, default_items, default_review_ids, deposit_type, deposit_value')
      .eq('company_id', c.companyId).eq('id', templateId).is('deleted_at', null).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    template = data as unknown as TemplateRow
  }

  const items: QuoteItem[] = (template?.default_items ?? []).map(i => ({
    name: i.name,
    description: i.description ?? '',
    quantity: Number(i.quantity) || 1,
    unit_price: i.unit_price == null ? null : Number(i.unit_price),
    optional: !!i.optional,
    recommended: !!i.optional && !!i.recommended,
    jobber_product_id: i.jobber_product_id ?? null,
  }))
  const totals = quoteTotals(items)

  const { data: quote, error } = await admin.from('quotes').insert({
    company_id: c.companyId,
    contact_id: contactId,
    jobber_client_id: customer.contact.jobberClientId,
    jobber_property_id: property?.jobberId ?? null,
    property_address: property?.address ?? atAddress,
    lawn_size_k: property?.lawnK ?? null,
    stop_id: stopId,
    lead_id: leadId,
    template_id: template?.id ?? null,
    title: template?.title ?? '',
    intro: template?.intro ?? '',
    terms: template?.terms ?? '',
    review_ids: template?.default_review_ids ?? [],
    deposit_type: template?.deposit_type ?? null,
    deposit_value: template?.deposit_value ?? null,
    status: 'draft',
    total_required: totals.required,
    total_selected: totals.required,
    salesperson_user_id: c.userId,
    // Unguessable link for the customer page (used once the quote is sent).
    share_token: randomBytes(24).toString('base64url'),
    created_by: c.userId,
    updated_by: c.userId,
  }).select('id').single()
  if (error || !quote) return NextResponse.json({ error: error?.message ?? 'Could not start the quote' }, { status: 500 })

  const itemErr = await replaceQuoteItems(admin, c.companyId, quote.id as string, items)
  if (itemErr) return NextResponse.json({ error: itemErr }, { status: 500 })
  await admin.from('quote_events').insert({ quote_id: quote.id, company_id: c.companyId, kind: 'created', actor_user_id: c.userId, meta: { template_id: template?.id ?? null, stop_id: stopId, lead_id: leadId } })
  return NextResponse.json({ id: quote.id })
}
