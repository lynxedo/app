import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxUserFlags } from '@/lib/inbox/permissions'
import type { InboxSavedView } from '../route'

export const dynamic = 'force-dynamic'

// Shared Inbox saved views — per-view API. Views are strictly PER-USER: every
// write is scoped to .eq('id', id).eq('user_id', userId), so an id belonging to
// another user (or tenant) can never be touched.

const VIEW_COLUMNS = 'id, name, config, sort_order'

// PATCH /api/hub/email/saved-views/[id] — partial update.
// Allowlist: name, config, sort_order (other keys ignored).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId } = auth

  const admin = createAdminClient()
  const flags = await getInboxUserFlags(admin, userId)
  if (!flags.hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'View name is required' }, { status: 400 })
    updates.name = name
  }

  if (body.config !== undefined) {
    if (typeof body.config !== 'object' || body.config === null || Array.isArray(body.config)) {
      return NextResponse.json({ error: 'config must be an object' }, { status: 400 })
    }
    updates.config = body.config
  }

  if (body.sort_order !== undefined) {
    if (typeof body.sort_order !== 'number' || !Number.isFinite(body.sort_order)) {
      return NextResponse.json({ error: 'sort_order must be a number' }, { status: 400 })
    }
    updates.sort_order = Math.trunc(body.sort_order)
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }
  updates.updated_at = new Date().toISOString()

  const { data: updated, error } = await admin
    .from('inbox_saved_views')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select(VIEW_COLUMNS)
    .maybeSingle()
  if (error) {
    // Renaming into an existing (user_id, name) → friendly 409.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A view with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ view: updated as InboxSavedView })
}

// DELETE /api/hub/email/saved-views/[id] — hard delete (it's the user's own view;
// no history to preserve). Scoped to the caller's own row.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId } = auth

  const admin = createAdminClient()
  const flags = await getInboxUserFlags(admin, userId)
  if (!flags.hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await admin
    .from('inbox_saved_views')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
