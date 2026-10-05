import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveQuoteCaller } from '@/lib/quote-access'
import { cleanDeposit, cleanTemplateItems, MAX_QUOTE_REVIEWS } from '@/lib/quotes'

// Quote templates (Work Orders & Quotes PRD — Phase 4, session 2). Ben builds
// his own templates (Oct 5 2026): nothing is seeded.
//   GET    → { templates }            anyone who can build quotes (active only);
//                                      ?all=1 for Quotes admins (includes turned-off)
//   POST   → create                   Quotes admins
//   PATCH  → update { id, …fields }   Quotes admins
//   DELETE → ?id=…  (soft)            Quotes admins
// A quote copies the template when it is made, so editing a template never
// changes a quote already made.

const COLS = 'id, name, service_line, title, intro, terms, default_items, default_review_ids, deposit_type, deposit_value, is_active, sort_order, updated_at'

type Admin = ReturnType<typeof createAdminClient>

async function clean(admin: Admin, companyId: string, body: Record<string, unknown>, partial: boolean): Promise<string | Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  if (!partial || body.name !== undefined) {
    const n = str(body.name, 120)
    if (!n) return 'Give the template a name (e.g. “Aeration + overseed”)'
    out.name = n
  }
  if (body.service_line !== undefined) out.service_line = str(body.service_line, 80) || null
  if (!partial || body.title !== undefined) out.title = str(body.title, 200)
  if (!partial || body.intro !== undefined) out.intro = str(body.intro, 6000)
  if (!partial || body.terms !== undefined) out.terms = str(body.terms, 12000)
  if (!partial || body.default_items !== undefined) {
    const items = cleanTemplateItems(body.default_items)
    if (typeof items === 'string') return items
    out.default_items = items
  }
  if (!partial || body.default_review_ids !== undefined) {
    const ids = Array.isArray(body.default_review_ids)
      ? Array.from(new Set(body.default_review_ids.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))).slice(0, MAX_QUOTE_REVIEWS)
      : []
    if (ids.length) {
      const { data } = await admin.from('company_reviews').select('id').eq('company_id', companyId).is('deleted_at', null).in('id', ids)
      const ok = new Set((data ?? []).map(r => r.id as string))
      out.default_review_ids = ids.filter(id => ok.has(id))
    } else out.default_review_ids = []
  }
  if (!partial || body.deposit_type !== undefined || body.deposit_value !== undefined) {
    const d = cleanDeposit(body.deposit_type, body.deposit_value)
    if (typeof d === 'string') return d
    Object.assign(out, d)
  }
  if (body.is_active !== undefined) out.is_active = body.is_active === true
  if (body.sort_order !== undefined && Number.isFinite(Number(body.sort_order))) out.sort_order = Math.trunc(Number(body.sort_order))
  return out
}

export async function GET(request: NextRequest) {
  const c = await resolveQuoteCaller('use')
  if ('error' in c) return c.error
  const all = request.nextUrl.searchParams.get('all') === '1' && c.canAdmin
  let q = createAdminClient().from('quote_templates').select(COLS)
    .eq('company_id', c.companyId).is('deleted_at', null)
  if (!all) q = q.eq('is_active', true)
  const { data, error } = await q.order('sort_order', { ascending: true }).order('name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ templates: data ?? [] })
}

export async function POST(request: NextRequest) {
  const c = await resolveQuoteCaller('admin')
  if ('error' in c) return c.error
  const admin = createAdminClient()
  const body = await request.json().catch(() => ({}))
  const v = await clean(admin, c.companyId, body, false)
  if (typeof v === 'string') return NextResponse.json({ error: v }, { status: 400 })
  const { data, error } = await admin.from('quote_templates')
    .insert({ ...v, company_id: c.companyId, created_by: c.userId, updated_by: c.userId })
    .select(COLS).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ template: data })
}

export async function PATCH(request: NextRequest) {
  const c = await resolveQuoteCaller('admin')
  if ('error' in c) return c.error
  const admin = createAdminClient()
  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : null
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const v = await clean(admin, c.companyId, body, true)
  if (typeof v === 'string') return NextResponse.json({ error: v }, { status: 400 })
  const { data, error } = await admin.from('quote_templates')
    .update({ ...v, updated_by: c.userId, updated_at: new Date().toISOString() })
    .eq('id', id).eq('company_id', c.companyId).is('deleted_at', null)
    .select(COLS).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ template: data })
}

export async function DELETE(request: NextRequest) {
  const c = await resolveQuoteCaller('admin')
  if ('error' in c) return c.error
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await createAdminClient().from('quote_templates')
    .update({ deleted_at: new Date().toISOString(), updated_by: c.userId })
    .eq('id', id).eq('company_id', c.companyId).is('deleted_at', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
