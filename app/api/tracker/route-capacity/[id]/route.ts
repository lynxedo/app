import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// TR2 — keys a client must never set via PATCH (identity / provenance / mirror).
const IMMUTABLE = ['id', 'company_id', 'monday_item_id', 'source', 'created_at']

async function callerCompanyId(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase.from('user_profiles').select('company_id').eq('id', userId).single()
  return data?.company_id ?? null
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const companyId = await callerCompanyId(supabase, user.id)
  if (!companyId) return NextResponse.json({ error: 'No company' }, { status: 403 })

  const { id } = await params
  const body = await request.json()
  const patch = { ...body }
  for (const k of IMMUTABLE) delete patch[k]

  const { data, error } = await supabase
    .from('route_capacity')
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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const companyId = await callerCompanyId(supabase, user.id)
  if (!companyId) return NextResponse.json({ error: 'No company' }, { status: 403 })

  const { id } = await params
  const { error } = await supabase
    .from('route_capacity')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId) // TR2 — scope to caller's company

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
