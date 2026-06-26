import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

const MAX_TITLE = 80
const MAX_BODY = 1500

// PATCH /api/admin/txt/templates/[id] — edit an org template in caller's company.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('txt_templates')
    .select('id, scope, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.scope !== 'org' || existing.company_id !== auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof body.title === 'string') {
    const title = body.title.trim()
    if (!title) return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
    if (title.length > MAX_TITLE)
      return NextResponse.json({ error: `Title max ${MAX_TITLE} chars` }, { status: 400 })
    patch.title = title
  }
  if (typeof body.body === 'string') {
    const text = body.body.trim()
    if (text.length > MAX_BODY)
      return NextResponse.json({ error: `Body max ${MAX_BODY} chars` }, { status: 400 })
    patch.body = text
  }
  if (Array.isArray(body.media)) {
    patch.media = body.media.filter((m: unknown) => typeof m === 'string').slice(0, 1)
  }
  if (Array.isArray(body.assigned_user_ids)) {
    patch.assigned_user_ids = Array.from(
      new Set(body.assigned_user_ids.filter((u: unknown) => typeof u === 'string'))
    )
  }
  if (Number.isFinite(body.sort_order)) patch.sort_order = Number(body.sort_order)

  const { data: updated, error } = await admin
    .from('txt_templates')
    .update(patch)
    .eq('id', id)
    .select('id, scope, title, body, media, sort_order, owner_user_id, assigned_user_ids, updated_at')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message || 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ template: updated })
}

// DELETE /api/admin/txt/templates/[id]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminArea('hub')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('txt_templates')
    .select('id, scope, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.scope !== 'org' || existing.company_id !== auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await admin.from('txt_templates').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
