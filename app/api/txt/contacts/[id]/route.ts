import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/twilio'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// PATCH /api/txt/contacts/[id]
// Body: { name?, phone?, email?, notes?, do_not_text? }
// Updates a txt_contact. Phone changes are validated + E.164-normalized.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))

  // Verify the contact exists and belongs to the company before mutating
  const admin = createAdminClient()
  const { data: existing, error: existingErr } = await admin
    .from('txt_contacts')
    .select('id, phone')
    .eq('id', id)
    .eq('company_id', HEROES_COMPANY_ID)
    .maybeSingle()
  if (existingErr || !existing) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) {
      return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    }
    patch.name = name
  }

  if (typeof body.phone === 'string') {
    const phoneE164 = toE164(body.phone)
    if (!phoneE164) {
      return NextResponse.json({ error: 'Invalid phone' }, { status: 400 })
    }
    patch.phone = phoneE164
  }

  if (body.email !== undefined) patch.email = body.email || null
  if (body.notes !== undefined) patch.notes = body.notes || null
  if (typeof body.do_not_text === 'boolean') patch.do_not_text = body.do_not_text

  const { data: updated, error: updErr } = await admin
    .from('txt_contacts')
    .update(patch)
    .eq('id', id)
    .select('id, name, phone, email, notes, do_not_text, jobber_client_id')
    .single()

  if (updErr || !updated) {
    return NextResponse.json(
      { error: updErr?.message || 'Update failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({ contact: updated })
}
