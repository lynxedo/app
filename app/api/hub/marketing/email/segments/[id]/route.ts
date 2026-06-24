import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEmailAccess } from '@/lib/email-auth'
import { normalizeFilter } from '@/lib/email-segments'

const MAX_NAME = 120
const SELECT = 'id, name, filter, created_by, created_at, updated_at'

// PATCH /api/hub/marketing/email/segments/[id] — update name/filter.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { id } = await params

  const body = await request.json().catch(() => ({}))
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) {
    const name = String(body.name || '').trim()
    if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })
    if (name.length > MAX_NAME) return NextResponse.json({ error: `Name max ${MAX_NAME} chars` }, { status: 400 })
    patch.name = name
  }
  if (body.filter !== undefined) patch.filter = normalizeFilter(body.filter)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('email_segments')
    .update(patch)
    .eq('id', id)
    .eq('company_id', access.companyId)
    .select(SELECT)
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message || 'Not found' }, { status: 404 })
  return NextResponse.json({ segment: data })
}

// DELETE /api/hub/marketing/email/segments/[id]
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { id } = await params

  const admin = createAdminClient()
  const { error } = await admin
    .from('email_segments')
    .delete()
    .eq('id', id)
    .eq('company_id', access.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
