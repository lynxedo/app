import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveQuoteCaller } from '@/lib/quote-access'
import { cleanQuoteItems, ITEM_COLS, loadQuoteCustomer, QUOTE_COLS, replaceQuoteItems } from '@/lib/quote-server'
import { cleanDeposit, MAX_QUOTE_REVIEWS, quoteTotals } from '@/lib/quotes'

// One quote (Phase 4, session 3).
//   GET    → { quote, items, customer: { contact, properties }, companyName }
//   PATCH  → autosave a DRAFT: any of title, intro, terms, internal_notes,
//            review_ids, deposit_type/value, jobber_property_id +
//            property_address, lawn_size_k, items[] (replaces all lines)
//   DELETE → soft-delete a DRAFT
// Anyone who can build quotes, same company. Sent quotes are edited by
// "Revise" (session 4), never in place — the customer may be looking at it.

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const c = await resolveQuoteCaller('use')
  if ('error' in c) return c.error
  const { id } = await params
  const admin = createAdminClient()
  const { data: quote } = await admin.from('quotes').select(QUOTE_COLS)
    .eq('company_id', c.companyId).eq('id', id).is('deleted_at', null).maybeSingle()
  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  const [{ data: items }, customer, { data: company }] = await Promise.all([
    admin.from('quote_line_items').select(ITEM_COLS).eq('quote_id', id).eq('company_id', c.companyId).order('sort_order'),
    loadQuoteCustomer(admin, c.companyId, quote.contact_id as string),
    admin.from('companies').select('name').eq('id', c.companyId).maybeSingle(),
  ])
  return NextResponse.json({ quote, items: items ?? [], customer, companyName: (company?.name as string | null) ?? '' })
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const c = await resolveQuoteCaller('use')
  if ('error' in c) return c.error
  const { id } = await params
  const admin = createAdminClient()
  const { data: cur } = await admin.from('quotes').select('id, status')
    .eq('company_id', c.companyId).eq('id', id).is('deleted_at', null).maybeSingle()
  if (!cur) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  if (cur.status !== 'draft') return NextResponse.json({ error: 'This quote has been sent — it can’t be changed here.' }, { status: 409 })

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  if (JSON.stringify(body).length > 300_000) return NextResponse.json({ error: 'Too large' }, { status: 413 })
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
  const up: Record<string, unknown> = {}
  if (body.title !== undefined) up.title = str(body.title, 200)
  if (body.intro !== undefined) up.intro = str(body.intro, 6000)
  if (body.terms !== undefined) up.terms = str(body.terms, 12000)
  if (body.internal_notes !== undefined) up.internal_notes = str(body.internal_notes, 6000)
  if (body.property_address !== undefined) up.property_address = str(body.property_address, 300) || null
  if (body.jobber_property_id !== undefined) up.jobber_property_id = str(body.jobber_property_id, 200) || null
  if (body.lawn_size_k !== undefined) {
    const k = Number(body.lawn_size_k)
    up.lawn_size_k = body.lawn_size_k === null || body.lawn_size_k === '' || !Number.isFinite(k) || k <= 0 ? null : Math.round(k * 100) / 100
  }
  if (body.deposit_type !== undefined || body.deposit_value !== undefined) {
    const d = cleanDeposit(body.deposit_type, body.deposit_value)
    if (typeof d === 'string') return NextResponse.json({ error: d }, { status: 400 })
    Object.assign(up, d)
  }
  if (body.review_ids !== undefined) {
    const ids = Array.isArray(body.review_ids)
      ? Array.from(new Set(body.review_ids.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))).slice(0, MAX_QUOTE_REVIEWS)
      : []
    if (ids.length) {
      const { data } = await admin.from('company_reviews').select('id').eq('company_id', c.companyId).is('deleted_at', null).in('id', ids)
      const ok = new Set((data ?? []).map(r => r.id as string))
      up.review_ids = ids.filter(x => ok.has(x))
    } else up.review_ids = []
  }
  if (body.items !== undefined) {
    const items = cleanQuoteItems(body.items)
    if (typeof items === 'string') return NextResponse.json({ error: items }, { status: 400 })
    const err = await replaceQuoteItems(admin, c.companyId, id, items)
    if (err) return NextResponse.json({ error: err }, { status: 500 })
    const t = quoteTotals(items)
    up.total_required = t.required
    up.total_selected = t.required
  }
  const { data, error } = await admin.from('quotes')
    .update({ ...up, updated_by: c.userId, updated_at: new Date().toISOString() })
    .eq('company_id', c.companyId).eq('id', id).eq('status', 'draft')
    .select('id, updated_at, total_required').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'This quote has been sent — it can’t be changed here.' }, { status: 409 })
  return NextResponse.json({ ok: true, updated_at: data.updated_at, total_required: data.total_required })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const c = await resolveQuoteCaller('use')
  if ('error' in c) return c.error
  const { id } = await params
  const { data, error } = await createAdminClient().from('quotes')
    .update({ deleted_at: new Date().toISOString(), updated_by: c.userId })
    .eq('company_id', c.companyId).eq('id', id).eq('status', 'draft').is('deleted_at', null)
    .select('id').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Only a draft can be deleted' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
