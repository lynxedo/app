import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateServiceMapping, parseServiceProductBody } from '@/lib/service-mapping-server'

export const dynamic = 'force-dynamic'

// PATCH — update a mapping row (autosave of rate / program / tank / notes / etc.).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await gateServiceMapping()
  if ('error' in ctx) return ctx.error
  const { id } = await params

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = parseServiceProductBody(body, true)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (Object.keys(parsed).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('service_products')
    .update({ ...parsed, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .is('deleted_at', null)
    .select('*')
    .single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That product is already mapped to this line item.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ serviceProduct: data })
}

// DELETE — soft delete (PRD safety rule: never a hard delete).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await gateServiceMapping()
  if ('error' in ctx) return ctx.error
  const { id } = await params

  const admin = createAdminClient()
  const { error } = await admin
    .from('service_products')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', ctx.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
