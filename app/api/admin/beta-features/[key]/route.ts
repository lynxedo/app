import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireBetaAdmin } from '@/lib/beta-auth'
import { BETA_FEATURE_SELECT } from '@/lib/beta-flags'

// Update / delete a single beta feature (super-admin only). PATCH allowlists the
// editable columns; DELETE hard-removes the row (and its opt-ins via FK cascade).

const EDITABLE = new Set([
  'label',
  'description',
  'screenshot_url',
  'is_available',
  'default_on',
  'sort_order',
  'retired_at',
])

export async function PATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const gate = await requireBetaAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const { key } = await params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  for (const k of Object.keys(body)) if (EDITABLE.has(k)) updates[k] = body[k]
  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: 'No editable fields provided.' }, { status: 400 })
  updates.updated_at = new Date().toISOString()

  const admin = createAdminClient()
  // Track 1 — beta_features.company_id: null = platform-global (today's admins manage
  // those), otherwise the row must belong to the caller's company. Restricting
  // GLOBAL-row edits to a true platform super-admin is a Track 6 follow-up.
  const { data: existing } = await admin
    .from('beta_features')
    .select('key, company_id')
    .eq('key', key)
    .maybeSingle()
  if (!existing || (existing.company_id !== null && existing.company_id !== gate.companyId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data, error } = await admin
    .from('beta_features')
    .update(updates)
    .eq('key', key)
    .select(BETA_FEATURE_SELECT)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ feature: data })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const gate = await requireBetaAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const { key } = await params
  const admin = createAdminClient()
  // Track 1 — same scope rule as PATCH: global (null company) rows stay manageable
  // today; another company's row answers like a missing key. (Track 6 follow-up:
  // restrict global-row deletes to a true platform super-admin.)
  const { data: existing } = await admin
    .from('beta_features')
    .select('key, company_id')
    .eq('key', key)
    .maybeSingle()
  if (!existing || (existing.company_id !== null && existing.company_id !== gate.companyId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error } = await admin.from('beta_features').delete().eq('key', key)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
