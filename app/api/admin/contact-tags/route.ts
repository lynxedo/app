import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

// GET /api/admin/contact-tags — list all tags for the caller's company,
// with assignment count per tag (for the "X contacts" badge in the admin UI).
export async function GET() {
  const check = await requireAdminArea('contacts')
  if (!check.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: tags, error } = await admin
    .from('contact_tags')
    .select('id, label, color, sort_order, created_at, created_by')
    .eq('company_id', check.company_id || '')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Per-tag assignment counts — single query, group by tag_id
  const tagIds = (tags ?? []).map(t => t.id)
  const counts: Record<string, number> = {}
  if (tagIds.length > 0) {
    const { data: assigns } = await admin
      .from('contact_tag_assignments')
      .select('tag_id')
      .in('tag_id', tagIds)
    for (const a of assigns ?? []) counts[a.tag_id] = (counts[a.tag_id] || 0) + 1
  }

  return NextResponse.json({
    tags: (tags ?? []).map(t => ({ ...t, count: counts[t.id] || 0 })),
  })
}

// POST /api/admin/contact-tags — create a tag
export async function POST(request: Request) {
  const check = await requireAdminArea('contacts')
  if (!check.ok || !check.company_id || !check.user) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const label = String(body.label || '').trim()
  const color = typeof body.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(body.color)
    ? body.color
    : '#6B7280'
  const sortOrder = Number.isFinite(body.sort_order) ? Math.trunc(body.sort_order) : 0

  if (!label) return NextResponse.json({ error: 'Label is required' }, { status: 400 })
  if (label.length > 60) return NextResponse.json({ error: 'Label too long (max 60)' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('contact_tags')
    .insert({
      company_id: check.company_id,
      label,
      color,
      sort_order: sortOrder,
      created_by: check.user.id,
    })
    .select('id, label, color, sort_order, created_at')
    .single()

  // 23505 = unique_violation on (company_id, label)
  if (error?.code === '23505') {
    return NextResponse.json({ error: 'A tag with this label already exists' }, { status: 409 })
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ tag: { ...data, count: 0 } }, { status: 201 })
}
