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

// Optional fields default to null when omitted or blank.
function normalizeOptionalString(v: unknown, max = 500): string | null | { err: string } {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') return { err: 'must be a string' }
  const trimmed = v.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > max) return { err: `too long (max ${max} chars)` }
  return trimmed
}

export async function GET() {
  const ctx = await gate()
  if ('error' in ctx) return ctx.error
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('pesticide_line_item_mappings')
    .select('id, match_text, match_type, chemical_name, epa_registration_number, active_ingredients, target_pests, application_rate, notes, active, created_at, updated_at')
    .eq('company_id', ctx.companyId)
    .order('chemical_name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ mappings: data ?? [] })
}

export async function POST(request: Request) {
  const ctx = await gate()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const matchText = typeof body.match_text === 'string' ? body.match_text.trim() : ''
  if (matchText.length < 2 || matchText.length > 200) {
    return NextResponse.json({ error: 'match_text must be 2-200 chars' }, { status: 400 })
  }

  const matchType = body.match_type === 'exact' ? 'exact' : 'contains'

  const chemicalName = typeof body.chemical_name === 'string' ? body.chemical_name.trim() : ''
  if (chemicalName.length < 1 || chemicalName.length > 200) {
    return NextResponse.json({ error: 'chemical_name must be 1-200 chars' }, { status: 400 })
  }

  // Optional fields
  const optionals: Record<string, string | null> = {}
  for (const key of ['epa_registration_number', 'active_ingredients', 'target_pests', 'application_rate', 'notes']) {
    const v = normalizeOptionalString(body[key], key === 'notes' ? 2000 : 500)
    if (v !== null && typeof v === 'object' && 'err' in v) {
      return NextResponse.json({ error: `${key} ${v.err}` }, { status: 400 })
    }
    optionals[key] = v as string | null
  }

  const active = body.active === false ? false : true

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('pesticide_line_item_mappings')
    .insert({
      company_id: ctx.companyId,
      match_text: matchText,
      match_type: matchType,
      chemical_name: chemicalName,
      ...optionals,
      active,
    })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ mapping: data })
}
