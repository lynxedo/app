import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

// PATCH /api/admin/txt/numbers/[id] — edit label or is_default.
// Body: { label?, is_default? }
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminArea('txt')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const admin = createAdminClient()
  // Ownership check — make sure this row belongs to the caller's company.
  const { data: existing } = await admin
    .from('txt_phone_numbers')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!existing || existing.company_id !== auth.company_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const patch: Record<string, unknown> = {}
  if ('label' in body) patch.label = body.label ? String(body.label).trim().slice(0, 80) : null
  if ('is_default' in body) patch.is_default = body.is_default === true

  // If flipping is_default → true, demote any existing default in same company first.
  if (patch.is_default === true) {
    await admin
      .from('txt_phone_numbers')
      .update({ is_default: false })
      .eq('company_id', auth.company_id)
      .eq('is_default', true)
      .neq('id', id)
  }

  const { data, error } = await admin
    .from('txt_phone_numbers')
    .update(patch)
    .eq('id', id)
    .select('id, twilio_number, label, is_default, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ number: data })
}

// DELETE /api/admin/txt/numbers/[id] — remove a number.
// FK from user_profiles + txt_conversations is ON DELETE SET NULL, so this
// won't cascade-destroy anything; existing convs just lose their stamp.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminArea('txt')
  if (!auth.ok || !auth.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('txt_phone_numbers')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!existing || existing.company_id !== auth.company_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error } = await admin.from('txt_phone_numbers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
