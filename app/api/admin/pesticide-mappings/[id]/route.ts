import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

async function gate() {
  const check = await requireAdminArea('daily_log')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id }
}

function normalizeOptionalString(v: unknown, max = 500): string | null | { err: string } {
  if (v === null) return null
  if (typeof v !== 'string') return { err: 'must be a string or null' }
  const trimmed = v.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > max) return { err: `too long (max ${max} chars)` }
  return trimmed
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await gate()
  if ('error' in ctx) return ctx.error
  const { id } = await context.params

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}

  if ('match_text' in body) {
    const v = typeof body.match_text === 'string' ? body.match_text.trim() : ''
    if (v.length < 2 || v.length > 200) {
      return NextResponse.json({ error: 'match_text must be 2-200 chars' }, { status: 400 })
    }
    update.match_text = v
  }

  if ('match_type' in body) {
    if (body.match_type !== 'exact' && body.match_type !== 'contains') {
      return NextResponse.json({ error: 'match_type must be exact or contains' }, { status: 400 })
    }
    update.match_type = body.match_type
  }

  if ('chemical_name' in body) {
    const v = typeof body.chemical_name === 'string' ? body.chemical_name.trim() : ''
    if (v.length < 1 || v.length > 200) {
      return NextResponse.json({ error: 'chemical_name must be 1-200 chars' }, { status: 400 })
    }
    update.chemical_name = v
  }

  for (const key of ['epa_registration_number', 'active_ingredients', 'target_pests', 'application_rate', 'notes']) {
    if (key in body) {
      const v = normalizeOptionalString(body[key], key === 'notes' ? 2000 : 500)
      if (v !== null && typeof v === 'object' && 'err' in v) {
        return NextResponse.json({ error: `${key} ${v.err}` }, { status: 400 })
      }
      update[key] = v
    }
  }

  if ('active' in body) {
    if (typeof body.active !== 'boolean') {
      return NextResponse.json({ error: 'active must be boolean' }, { status: 400 })
    }
    update.active = body.active
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('pesticide_line_item_mappings')
    .update(update)
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ mapping: data })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await gate()
  if ('error' in ctx) return ctx.error
  const { id } = await context.params

  const admin = createAdminClient()
  const { error } = await admin
    .from('pesticide_line_item_mappings')
    .delete()
    .eq('id', id)
    .eq('company_id', ctx.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
