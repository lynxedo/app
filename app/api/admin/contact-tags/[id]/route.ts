import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

// PATCH /api/admin/contact-tags/:id — rename, recolor, reorder
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const check = await requireAdminArea('contacts')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const update: Record<string, unknown> = {}
  if (typeof body.label === 'string') {
    const l = body.label.trim()
    if (!l) return NextResponse.json({ error: 'Label cannot be empty' }, { status: 400 })
    if (l.length > 60) return NextResponse.json({ error: 'Label too long (max 60)' }, { status: 400 })
    update.label = l
  }
  if (typeof body.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(body.color)) {
    update.color = body.color
  }
  if (Number.isFinite(body.sort_order)) {
    update.sort_order = Math.trunc(body.sort_order)
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('contact_tags')
    .update(update)
    .eq('id', id)
    .eq('company_id', check.company_id)
    .select('id, label, color, sort_order')
    .single()

  if (error?.code === '23505') {
    return NextResponse.json({ error: 'A tag with this label already exists' }, { status: 409 })
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ tag: data })
}

// DELETE /api/admin/contact-tags/:id — also drops assignments via FK cascade
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const check = await requireAdminArea('contacts')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('contact_tags')
    .delete()
    .eq('id', id)
    .eq('company_id', check.company_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
