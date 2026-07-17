import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'

// TR2 — keys a client must never set via PATCH (identity / provenance / mirror).
const IMMUTABLE = ['id', 'company_id', 'monday_item_id', 'source', 'created_at']

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { companyId, supabase } = auth // reuse the helper's RLS session client

  const { id } = await params
  const body = await request.json()
  const patch = { ...body }
  for (const k of IMMUTABLE) delete patch[k]

  const { data, error } = await supabase
    .from('recurring_services')
    .update(patch)
    .eq('id', id)
    .eq('company_id', companyId) // TR2 — scope to caller's company
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { companyId, supabase } = auth // reuse the helper's RLS session client

  const { id } = await params
  const { error } = await supabase
    .from('recurring_services')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId) // TR2 — scope to caller's company

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
