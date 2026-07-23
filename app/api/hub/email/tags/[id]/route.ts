import { NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { InboxTag } from '../route'

export const dynamic = 'force-dynamic'

// Shared Inbox tags — per-tag admin API (same Integrations gate as the collection
// route). Every write is scoped to the caller's company so an id from another
// tenant can never be touched.

const KINDS = ['type', 'outcome'] as const
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const TAG_COLUMNS = 'id, company_id, kind, name, color, outlook_category, sort_order, active'

// PATCH /api/hub/email/tags/[id] — partial update.
// Allowlist: name, color, kind, sort_order, outlook_category, active (other keys ignored).
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
    if (!name) return NextResponse.json({ error: 'Tag name is required' }, { status: 400 })
    updates.name = name
  }

  if (body.color !== undefined) {
    const c = typeof body.color === 'string' ? body.color.trim() : ''
    if (!HEX_RE.test(c)) {
      return NextResponse.json({ error: 'color must be a hex color like #2563eb' }, { status: 400 })
    }
    updates.color = c
  }

  if (body.kind !== undefined) {
    if (!(KINDS as readonly string[]).includes(body.kind)) {
      return NextResponse.json({ error: `kind must be one of: ${KINDS.join(', ')}` }, { status: 400 })
    }
    updates.kind = body.kind
  }

  if (body.sort_order !== undefined) {
    if (typeof body.sort_order !== 'number' || !Number.isFinite(body.sort_order)) {
      return NextResponse.json({ error: 'sort_order must be a number' }, { status: 400 })
    }
    updates.sort_order = Math.trunc(body.sort_order)
  }

  if (body.outlook_category !== undefined) {
    // Empty/blank → null (fall back to the tag name when mirroring — Decision J).
    updates.outlook_category =
      typeof body.outlook_category === 'string' && body.outlook_category.trim()
        ? body.outlook_category.trim()
        : null
  }

  if (body.active !== undefined) updates.active = !!body.active

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }
  updates.updated_at = new Date().toISOString()

  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('inbox_tags')
    .update(updates)
    .eq('id', id)
    .eq('company_id', companyId)
    .select(TAG_COLUMNS)
    .maybeSingle()
  if (error) {
    // Renaming into an existing (kind, name) → friendly 409.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A tag with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ tag: updated as InboxTag })
}

// DELETE /api/hub/email/tags/[id] — SOFT delete = deactivate (active=false), so
// history on already-tagged threads is preserved. Company-scoped.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const check = await requireAdminArea('integrations')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('inbox_tags')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', check.company_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
