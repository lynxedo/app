import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

const MAX_TITLE = 80
const MAX_BODY = 1500

// GET /api/admin/txt/templates — list all ORG templates for the caller's company.
export async function GET() {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('txt_templates')
    .select('id, scope, title, body, media, sort_order, owner_user_id, updated_at')
    .eq('company_id', auth.company_id)
    .eq('scope', 'org')
    .order('sort_order', { ascending: true })
    .order('title', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ templates: data || [] })
}

// POST /api/admin/txt/templates — create a new org template.
// Body: { title, body, sort_order? }
export async function POST(request: Request) {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const title = String(body.title || '').trim()
  const text = String(body.body || '').trim()
  const sortOrder = Number.isFinite(body.sort_order) ? Number(body.sort_order) : 0
  const media = Array.isArray(body.media)
    ? body.media.filter((m: unknown) => typeof m === 'string').slice(0, 1)
    : []

  if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 })
  if (!text && media.length === 0)
    return NextResponse.json({ error: 'Add a message or an attachment' }, { status: 400 })
  if (title.length > MAX_TITLE)
    return NextResponse.json({ error: `Title max ${MAX_TITLE} chars` }, { status: 400 })
  if (text.length > MAX_BODY)
    return NextResponse.json({ error: `Body max ${MAX_BODY} chars` }, { status: 400 })

  const admin = createAdminClient()
  const { data: inserted, error } = await admin
    .from('txt_templates')
    .insert({
      company_id: auth.company_id,
      scope: 'org',
      owner_user_id: null,
      title,
      body: text,
      media,
      sort_order: sortOrder,
    })
    .select('id, scope, title, body, media, sort_order, owner_user_id, updated_at')
    .single()

  if (error || !inserted) {
    return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json({ template: inserted })
}
