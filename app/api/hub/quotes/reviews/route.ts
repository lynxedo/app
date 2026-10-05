import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveQuoteCaller } from '@/lib/quote-access'

// Reviews shown at the bottom of a quote (Phase 4, session 2). Ben pastes them
// in himself (Oct 5 2026) — the list starts empty; a quote shows up to 3.
//   GET    → { reviews }              anyone who can build quotes
//   POST   → create                   Quotes admins
//   PATCH  → update { id, …fields }   Quotes admins
//   DELETE → ?id=…  (soft)            Quotes admins

const COLS = 'id, author, rating, body, review_date, source, source_url, featured, sort_order, updated_at'
const SOURCES = ['google', 'facebook', 'nextdoor', 'yelp', 'angi', 'other']

function clean(body: Record<string, unknown>, partial: boolean): string | Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  if (!partial || body.author !== undefined) {
    const a = str(body.author, 120)
    if (!a) return 'Enter who wrote the review'
    out.author = a
  }
  if (!partial || body.body !== undefined) {
    const b = str(body.body, 4000)
    if (!b) return 'Paste the review text'
    out.body = b
  }
  if (!partial || body.rating !== undefined) {
    const r = Math.round(Number(body.rating ?? 5))
    if (!(r >= 1 && r <= 5)) return 'Stars must be 1 to 5'
    out.rating = r
  }
  if (body.review_date !== undefined) {
    const d = str(body.review_date, 10)
    out.review_date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
  }
  if (body.source !== undefined) {
    const s = str(body.source, 20).toLowerCase()
    out.source = SOURCES.includes(s) ? s : 'other'
  }
  if (body.source_url !== undefined) {
    const u = str(body.source_url, 1000)
    if (u && !/^https:\/\//i.test(u)) return 'The link must start with https://'
    out.source_url = u || null
  }
  if (body.featured !== undefined) out.featured = body.featured === true
  if (body.sort_order !== undefined && Number.isFinite(Number(body.sort_order))) out.sort_order = Math.trunc(Number(body.sort_order))
  return out
}

export async function GET() {
  const c = await resolveQuoteCaller('use')
  if ('error' in c) return c.error
  const { data, error } = await createAdminClient().from('company_reviews').select(COLS)
    .eq('company_id', c.companyId).is('deleted_at', null)
    .order('featured', { ascending: false }).order('sort_order', { ascending: true }).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ reviews: data ?? [] })
}

export async function POST(request: NextRequest) {
  const c = await resolveQuoteCaller('admin')
  if ('error' in c) return c.error
  const body = await request.json().catch(() => ({}))
  const v = clean(body, false)
  if (typeof v === 'string') return NextResponse.json({ error: v }, { status: 400 })
  const { data, error } = await createAdminClient().from('company_reviews')
    .insert({ ...v, company_id: c.companyId, created_by: c.userId })
    .select(COLS).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ review: data })
}

export async function PATCH(request: NextRequest) {
  const c = await resolveQuoteCaller('admin')
  if ('error' in c) return c.error
  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : null
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const v = clean(body, true)
  if (typeof v === 'string') return NextResponse.json({ error: v }, { status: 400 })
  const { data, error } = await createAdminClient().from('company_reviews')
    .update({ ...v, updated_at: new Date().toISOString() })
    .eq('id', id).eq('company_id', c.companyId).is('deleted_at', null)
    .select(COLS).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ review: data })
}

export async function DELETE(request: NextRequest) {
  const c = await resolveQuoteCaller('admin')
  if ('error' in c) return c.error
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const admin = createAdminClient()
  const { error } = await admin.from('company_reviews')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id).eq('company_id', c.companyId).is('deleted_at', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
