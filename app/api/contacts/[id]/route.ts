import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/phone'

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
      id, company_id, name, first_name, last_name, company_name, is_company,
      phone, email, email_status, do_not_text, notes, jobber_client_id, sources, created_at,
      address_line1, address_line2, city, state, postal_code, country,
      tags:contact_tag_assignments(tag_id, contact_tags(id, label, color))
    `)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  type RawContact = {
    id: string; company_id: string; name: string
    first_name: string | null; last_name: string | null; company_name: string | null; is_company: boolean
    phone: string; email: string | null; email_status: string
    do_not_text: boolean; notes: string | null; jobber_client_id: string | null; sources: string[]; created_at: string
    address_line1: string | null; address_line2: string | null; city: string | null
    state: string | null; postal_code: string | null; country: string | null
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
    update.phone_digits = e.replace(/\D/g, '')
  }
  if ('email' in body) update.email = body.email ? String(body.email).trim() : null
  if ('notes' in body) update.notes = body.notes ? String(body.notes).trim() : null
  if (typeof body.do_not_text === 'boolean') update.do_not_text = body.do_not_text
  if (typeof body.is_company === 'boolean') update.is_company = body.is_company
  if (typeof body.email_status === 'string') update.email_status = body.email_status.trim()
  for (const f of ['first_name', 'last_name', 'company_name', 'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country'] as const) {
    if (f in body) update[f] = body[f] ? String(body[f]).trim() : null
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  // A hand edit makes this row's core fields human-owned: the Jobber cron must
  // not later clobber them (see CRM_CONTACTS_PRD §8).
  update.manually_edited = true

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('txt_contacts')
    .update(update)
    .eq('id', id)
    .select(`
      id, name, first_name, last_name, company_name, is_company,
      phone, email, email_status, do_not_text, notes, jobber_client_id, sources,
      address_line1, address_line2, city, state, postal_code, country
    `)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ contact: data })
}

// DELETE /api/contacts/:id — SOFT delete (sets deleted_at). The row and its
// tag assignments + message/call/voicemail history stay intact; the contact
// just drops out of the directory and every filtered view. Reversible.
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
  const { error } = await admin
    .from('txt_contacts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
