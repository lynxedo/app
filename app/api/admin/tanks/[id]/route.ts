import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateTankAdmin, parseTankBody } from '@/lib/route-capacity-server'

export const dynamic = 'force-dynamic'

// PATCH — edit a tank.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await gateTankAdmin()
  if ('error' in ctx) return ctx.error
  const { id } = await params

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = parseTankBody(body, true)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (Object.keys(parsed).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tank_configs')
    .update({ ...parsed, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .select('id, tank_number, label, gallon_capacity, application_rate, is_active, created_at, updated_at')
    .single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A tank with that number already exists.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ tank: data })
}

// DELETE — remove a tank (config row; re-addable). Tank assignments key by
// tank_number, not an FK, so this leaves no dangling reference.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await gateTankAdmin()
  if ('error' in ctx) return ctx.error
  const { id } = await params

  const admin = createAdminClient()
  const { error } = await admin
    .from('tank_configs')
    .delete()
    .eq('id', id)
    .eq('company_id', ctx.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
