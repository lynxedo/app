import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/twilio'

// GET /api/contacts/:id — full detail incl. tags
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('txt_contacts')
    .select(`
      id, company_id, name, phone, email, do_not_text, notes, jobber_client_id, created_at,
      tags:contact_tag_assignments(tag_id, contact_tags(id, label, color))
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  type RawContact = {
    id: string; company_id: string; name: string; phone: string; email: string | null
    do_not_text: boolean; notes: string | null; jobber_client_id: string | null; created_at: string
    tags: Array<{ tag_id: string; contact_tags: { id: string; label: string; color: string } | { id: string; label: string; color: string }[] | null }>
  }
  const raw = data as unknown as RawContact
  const tags = (raw.tags ?? []).flatMap(t => {
    const inner = Array.isArray(t.contact_tags) ? t.contact_tags : (t.contact_tags ? [t.contact_tags] : [])
    return inner
  })

  return NextResponse.json({ contact: { ...raw, tags } })
}

// PATCH /api/contacts/:id — edit name/email/notes/phone/do_not_text
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  // Verify caller can see this contact (RLS already does this on the SELECT)
  const { data: target } = await supabase
    .from('txt_contacts')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (target.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const update: Record<string, unknown> = {}
  if (typeof body.name === 'string') {
    const n = body.name.trim()
    if (!n) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    update.name = n
  }
  if (typeof body.phone === 'string') {
    const e = toE164(body.phone)
    if (!e) return NextResponse.json({ error: 'Invalid phone' }, { status: 400 })
    update.phone = e
  }
  if ('email' in body) update.email = body.email ? String(body.email).trim() : null
  if ('notes' in body) update.notes = body.notes ? String(body.notes).trim() : null
  if (typeof body.do_not_text === 'boolean') update.do_not_text = body.do_not_text

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('txt_contacts')
    .update(update)
    .eq('id', id)
    .select('id, name, phone, email, do_not_text, notes, jobber_client_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ contact: data })
}

// DELETE /api/contacts/:id — hard delete. Cascades to contact_tag_assignments.
// Doesn't cascade to txt_conversations / txt_messages / calls / voicemails
// (those FKs are SET NULL or nullable on contact_id), so a deleted contact
// keeps message/call history intact under "Unknown."
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { data: target } = await supabase
    .from('txt_contacts')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (target.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('txt_contacts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
