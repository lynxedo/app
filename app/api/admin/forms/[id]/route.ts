import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

async function requireFormsAdmin(formId: string) {
  const check = await requireAdminArea('forms')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  // Verify the form belongs to this company
  const admin = createAdminClient()
  const { data: form } = await admin
    .from('forms')
    .select('id, company_id')
    .eq('id', formId)
    .eq('company_id', check.company_id)
    .single()
  if (!form) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { companyId: check.company_id }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireFormsAdmin(id)
  if ('error' in ctx) return ctx.error

  const admin = createAdminClient()
  const { data, error } = await admin.from('forms').select('*').eq('id', id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ form: data })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireFormsAdmin(id)
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const allowed = ['name', 'description', 'fields', 'notification_sms_template', 'active']
  const updates: Record<string, unknown> = {}
  for (const k of allowed) {
    if (k in body) updates[k] = body[k]
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('forms')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ form: data })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireFormsAdmin(id)
  if ('error' in ctx) return ctx.error

  const admin = createAdminClient()
  const { error } = await admin.from('forms').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
