import { NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { InboxTemplate } from '../route'

export const dynamic = 'force-dynamic'

// Shared Inbox templates — per-template admin API (same Integrations gate as the
// collection route). Every write is scoped to the caller's company so an id from
// another tenant can never be touched.

const TEMPLATE_COLUMNS = 'id, company_id, name, subject, body_html, sort_order, active'

// PATCH /api/hub/email/templates/[id] — partial update.
// Allowlist: name, subject, body_html, sort_order, active (other keys ignored).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const check = await requireAdminArea('integrations')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const companyId = check.company_id

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'Template name is required' }, { status: 400 })
    updates.name = name
  }

  if (body.subject !== undefined) {
    // Blank → null (falls back to the reply/thread subject when inserted).
    updates.subject =
      typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : null
  }

  if (body.body_html !== undefined) {
    updates.body_html = typeof body.body_html === 'string' ? body.body_html : ''
  }

  if (body.sort_order !== undefined) {
    if (typeof body.sort_order !== 'number' || !Number.isFinite(body.sort_order)) {
      return NextResponse.json({ error: 'sort_order must be a number' }, { status: 400 })
    }
    updates.sort_order = Math.trunc(body.sort_order)
  }

  if (body.active !== undefined) updates.active = !!body.active

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }
  updates.updated_at = new Date().toISOString()

  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('inbox_templates')
    .update(updates)
    .eq('id', id)
    .eq('company_id', companyId)
    .select(TEMPLATE_COLUMNS)
    .maybeSingle()
  if (error) {
    // Renaming into an existing (company_id, name) → friendly 409.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A template with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ template: updated as InboxTemplate })
}

// DELETE /api/hub/email/templates/[id] — SOFT delete = deactivate (active=false),
// so the template stops appearing in composers but isn't destroyed. Company-scoped.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const check = await requireAdminArea('integrations')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('inbox_templates')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', check.company_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
