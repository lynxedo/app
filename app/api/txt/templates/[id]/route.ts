import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_TITLE = 80
const MAX_BODY = 1500

// PATCH /api/txt/templates/[id] — owner-only edit of a personal template.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('txt_templates')
    .select('id, scope, owner_user_id')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.scope !== 'personal' || existing.owner_user_id !== user.id) {
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
  if (Number.isFinite(body.sort_order)) patch.sort_order = Number(body.sort_order)

  const { data: updated, error } = await admin
    .from('txt_templates')
    .update(patch)
    .eq('id', id)
    .select('id, scope, title, body, media, sort_order, owner_user_id, updated_at')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message || 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ template: updated })
}

// DELETE /api/txt/templates/[id] — owner-only.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('txt_templates')
    .select('id, scope, owner_user_id')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.scope !== 'personal' || existing.owner_user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await admin.from('txt_templates').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
