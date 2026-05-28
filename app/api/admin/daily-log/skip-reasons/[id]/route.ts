import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

async function requireAdmin() {
  const check = await requireAdminArea('daily_log')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error
  const { id } = await context.params
  const admin = createAdminClient()

  // Verify the reason belongs to this company before modifying.
  const { data: existing } = await admin
    .from('daily_log_skip_reasons')
    .select('id')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .single()
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => ({})) as {
    label?: unknown
    sort_order?: unknown
    active?: unknown
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.label === 'string') {
    const label = body.label.trim()
    if (!label || label.length > 100) {
      return NextResponse.json({ error: 'label must be 1–100 characters' }, { status: 400 })
    }
    updates.label = label
  }
  if (typeof body.sort_order === 'number') updates.sort_order = Math.round(body.sort_order)
  if (typeof body.active === 'boolean') updates.active = body.active

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data: updated, error } = await admin
    .from('daily_log_skip_reasons')
    .update(updates)
    .eq('id', id)
    .select('id, label, sort_order, active, created_at')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }
  return NextResponse.json({ reason: updated })
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error
  const { id } = await context.params
  const admin = createAdminClient()

  // Verify company scope.
  const { data: existing } = await admin
    .from('daily_log_skip_reasons')
    .select('id')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .single()
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error } = await admin
    .from('daily_log_skip_reasons')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
