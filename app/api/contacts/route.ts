import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/phone'
import { ilikeSearchPattern } from '@/lib/search'

// GET /api/contacts
//   ?search=...            (matches name / phone / email)
//   ?tag_ids=uuid,uuid     (AND semantics — contact must have ALL listed tags)
//   ?untagged=1            (only contacts with zero tags)
//   ?channel=phone|email   (has-phone / has-email — the per-tool directory views)
//   ?source=jobber|manual|import|sms|voice
//   ?status=subscribed|unsubscribed|bounced|complained   (email subscription status)
//   ?include_do_not_text=1
//   ?limit=200
//
// Backed by the txt_contacts table — the unified contacts directory (the CRM
// core). Its user-facing name is just "Contacts". RLS scopes to the caller's
// company; the tag-filter join goes through contact_tag_assignments which is
// also company-scoped via the contact relationship. Soft-deleted rows
// (deleted_at) are always excluded.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const search = (url.searchParams.get('search') || '').trim()
  const tagIdsParam = url.searchParams.get('tag_ids') || ''
  const tagIds = tagIdsParam.split(',').map(s => s.trim()).filter(Boolean)
  const untagged = url.searchParams.get('untagged') === '1'
  const channel = (url.searchParams.get('channel') || '').trim()
  const source = (url.searchParams.get('source') || '').trim()
  const status = (url.searchParams.get('status') || '').trim()
  const includeBlocked = url.searchParams.get('include_do_not_text') === '1'
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1000)

  let query = supabase
    .from('txt_contacts')
    .select(`
      id, name, first_name, last_name, company_name, is_company,
      phone, email, email_status, do_not_text, notes, jobber_client_id, sources,
      address_line1, address_line2, city, state, postal_code, country,
      tags:contact_tag_assignments(tag_id, contact_tags(id, label, color))
    `)
    .is('deleted_at', null)
    .eq('in_directory', true)
    .order('name', { ascending: true })
    .limit(limit)

  if (!includeBlocked) query = query.eq('do_not_text', false)
  if (channel === 'phone') query = query.not('phone', 'is', null)
  if (channel === 'email') query = query.not('email', 'is', null)
  if (source) query = query.contains('sources', [source])
  if (status) query = query.eq('email_status', status)

  if (search) {
    const pattern = ilikeSearchPattern(search)
    query = query.or(`name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Flatten nested tag rows: contact_tag_assignments → contact_tags
  type RawContact = {
    id: string; name: string; first_name: string | null; last_name: string | null
    company_name: string | null; is_company: boolean
    phone: string; email: string | null; email_status: string
    do_not_text: boolean; notes: string | null; jobber_client_id: string | null; sources: string[]
    address_line1: string | null; address_line2: string | null; city: string | null
    state: string | null; postal_code: string | null; country: string | null
    tags: Array<{ tag_id: string; contact_tags: { id: string; label: string; color: string } | { id: string; label: string; color: string }[] | null }>
  }
  const shaped = (data as unknown as RawContact[] ?? []).map(c => {
    const tags = (c.tags ?? []).flatMap(t => {
      const inner = Array.isArray(t.contact_tags) ? t.contact_tags : (t.contact_tags ? [t.contact_tags] : [])
      return inner
    })
    return { ...c, tags }
  })

  // Tag filtering applied in JS — the embed is needed anyway for display, so
  // doing this in a single round-trip is simpler than a server-side filter
  // through a join table. Heroes has on the order of 100 contacts; scale is
  // not an issue.
  let filtered = shaped
  if (tagIds.length > 0) {
    filtered = filtered.filter(c => {
      const ids = new Set(c.tags.map(t => t.id))
      return tagIds.every(t => ids.has(t))
    })
  }
  if (untagged) {
    filtered = filtered.filter(c => c.tags.length === 0)
  }

  return NextResponse.json({ contacts: filtered })
}

// POST /api/contacts — create a new contact (no conversation start, unlike
// /api/txt/conversations/start which also opens a thread). Use this for
// purely-contact creation from the Contacts page.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  const phoneRaw = String(body.phone || '').trim()
  const email = body.email ? String(body.email).trim() : null
  const notes = body.notes ? String(body.notes).trim() : null
  const str = (k: string) => (body[k] ? String(body[k]).trim() : null)
  const tagIds: string[] = Array.isArray(body.tag_ids) ? body.tag_ids.filter((x: unknown) => typeof x === 'string') : []

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!phoneRaw) return NextResponse.json({ error: 'Phone is required' }, { status: 400 })
  const phone = toE164(phoneRaw)
  if (!phone) return NextResponse.json({ error: 'Invalid phone' }, { status: 400 })

  // Optional directory fields (the page can post these; all default-safe).
  const directoryFields = {
    first_name: str('first_name'),
    last_name: str('last_name'),
    company_name: str('company_name'),
    is_company: body.is_company === true,
    address_line1: str('address_line1'),
    address_line2: str('address_line2'),
    city: str('city'),
    state: str('state'),
    postal_code: str('postal_code'),
    country: str('country'),
  }

  const admin = createAdminClient()

  // Find-or-create by (company_id, phone) — same uniqueness as the existing
  // /api/txt/conversations/start path uses.
  const { data: existing } = await admin
    .from('txt_contacts')
    .select('id, sources')
    .eq('company_id', profile.company_id)
    .eq('phone', phone)
    .maybeSingle()

  let contactId: string
  if (existing) {
    contactId = existing.id
    const sources = Array.from(new Set([...(existing.sources ?? []), 'manual']))
    await admin
      .from('txt_contacts')
      .update({ name, email, notes, ...directoryFields, sources, manually_edited: true, in_directory: true })
      .eq('id', contactId)
  } else {
    const { data: created, error } = await admin
      .from('txt_contacts')
      .insert({
        company_id: profile.company_id, name, phone, email, notes,
        phone_digits: phone.replace(/\D/g, ''),
        sources: ['manual'], manually_edited: true,
        ...directoryFields,
      })
      .select('id')
      .single()
    if (error || !created) {
      return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 })
    }
    contactId = created.id
  }

  // Apply tags if provided. Validate tags belong to same company (defense
  // against forged tag_ids) before assigning.
  if (tagIds.length > 0) {
    const { data: validTags } = await admin
      .from('contact_tags')
      .select('id')
      .eq('company_id', profile.company_id)
      .in('id', tagIds)
    const ok = (validTags ?? []).map(t => t.id)
    if (ok.length > 0) {
      await admin
        .from('contact_tag_assignments')
        .upsert(
          ok.map(tag_id => ({ contact_id: contactId, tag_id, assigned_by: user.id })),
          { onConflict: 'contact_id,tag_id' }
        )
    }
  }

  return NextResponse.json({ id: contactId }, { status: 201 })
}
