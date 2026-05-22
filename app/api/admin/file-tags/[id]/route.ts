import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

const VALID_TAG_TYPES = ['general', 'social-page', 'social-queue'] as const
type TagType = (typeof VALID_TAG_TYPES)[number]

async function requireAdmin() {
  const check = await requireAdminArea('hub')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error
  const { id } = await params

  const body = await request.json().catch(() => ({}))
  const admin = createAdminClient()

  const { data: existing, error: fetchErr } = await admin
    .from('hub_file_tags')
    .select('id, name, color, tag_type, description, company_id')
    .eq('id', id)
    .single()

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
  }
  if (existing.company_id !== ctx.companyId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const updates: Record<string, unknown> = {}
  let renamedFrom: string | null = null
  let renamedTo: string | null = null

  if (typeof body.name === 'string') {
    const newName = body.name.trim()
    if (!newName) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    if (newName !== existing.name) {
      updates.name = newName
      renamedFrom = existing.name
      renamedTo = newName
    }
  }
  if (typeof body.color === 'string') {
    const c = body.color.trim()
    if (!/^#[0-9a-fA-F]{6}$/.test(c)) {
      return NextResponse.json({ error: 'color must be a 6-digit hex like #F97316' }, { status: 400 })
    }
    updates.color = c
  }
  if (typeof body.tag_type === 'string') {
    const t = body.tag_type.trim()
    if (!VALID_TAG_TYPES.includes(t as TagType)) {
      return NextResponse.json({ error: `tag_type must be one of ${VALID_TAG_TYPES.join(', ')}` }, { status: 400 })
    }
    updates.tag_type = t
  }
  if (body.description !== undefined) {
    updates.description = typeof body.description === 'string' ? body.description.trim() || null : null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ tag: existing })
  }

  const { data: updated, error: updateErr } = await admin
    .from('hub_file_tags')
    .update(updates)
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .select('id, name, color, tag_type, description, created_at')
    .single()

  if (updateErr) {
    if (updateErr.code === '23505') {
      return NextResponse.json({ error: 'A tag with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // If renamed, rewrite the tag string across hub_files.tags arrays for this company
  if (renamedFrom && renamedTo) {
    const { error: rewriteErr } = await admin.rpc('hub_files_rename_tag', {
      p_company_id: ctx.companyId,
      p_old_name: renamedFrom,
      p_new_name: renamedTo,
    })
    if (rewriteErr) {
      return NextResponse.json({
        tag: updated,
        warning: `Tag updated, but failed to rewrite existing file tags: ${rewriteErr.message}`,
      })
    }
  }

  return NextResponse.json({ tag: updated })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error
  const { id } = await params

  const admin = createAdminClient()

  const { data: existing, error: fetchErr } = await admin
    .from('hub_file_tags')
    .select('id, name, company_id')
    .eq('id', id)
    .single()

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
  }
  if (existing.company_id !== ctx.companyId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Strip the tag string from any hub_files.tags arrays first
  const { error: stripErr } = await admin.rpc('hub_files_remove_tag', {
    p_company_id: ctx.companyId,
    p_name: existing.name,
  })
  if (stripErr) {
    return NextResponse.json({ error: `Failed to clean up files: ${stripErr.message}` }, { status: 500 })
  }

  const { error: deleteErr } = await admin
    .from('hub_file_tags')
    .delete()
    .eq('id', id)
    .eq('company_id', ctx.companyId)

  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
