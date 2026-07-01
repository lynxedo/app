import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/twilio'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// GET /api/txt/contacts?search=...&limit=200&include_do_not_text=0
//
// Lists txt_contacts for the caller's company. Used by the broadcast and
// group-conversation composers, the New-conversation search, and the
// Contacts page. By default excludes do_not_text contacts — pass
// include_do_not_text=1 to see them (contact-management contexts use this).
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const search = (url.searchParams.get('search') || '').trim()
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1000)
  const includeBlocked = url.searchParams.get('include_do_not_text') === '1'

  let query = supabase
    .from('txt_contacts')
    .select('id, name, phone, email, do_not_text, notes, jobber_client_id')
    .eq('company_id', HEROES_COMPANY_ID)
    // This is the texting view (broadcast/group composers + new-conversation
    // search). The unified contacts directory now holds email-only contacts with
    // a null phone — they can't be texted, so exclude them. Leaving them in
    // crashed the composer's phone formatter (null.replace) → white screen.
    .not('phone', 'is', null)
    .eq('in_directory', true)
    .order('name', { ascending: true })
    .limit(limit)

  if (!includeBlocked) query = query.eq('do_not_text', false)
  if (search) {
    const pattern = `%${search.replace(/[%_]/g, '\\$&')}%`
    query = query.or(`name.ilike.${pattern},phone.ilike.${pattern}`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ contacts: data ?? [] })
}

// POST /api/txt/contacts
// Body: { name, phone, email?, notes? }
// Creates a contact in the company's address book (no conversation). Used by
// the "+ Add contact" flow and the Contacts page. Phone is E.164-normalized
// and deduped — a contact with the same phone returns 409 with the existing id.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const name: string = (body.name || '').trim()
  const phoneE164 = toE164(body.phone || '')
  const email: string | null = (body.email || '').trim() || null
  const notes: string | null = (body.notes || '').trim() || null

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!phoneE164) return NextResponse.json({ error: 'Invalid phone' }, { status: 400 })

  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('txt_contacts')
    .select('id, sources')
    .eq('company_id', HEROES_COMPANY_ID)
    .eq('phone', phoneE164)
    .maybeSingle()

  // If a record already exists for this number — including a hidden, inbound-only
  // stub from a past text/call — adopt it: fill in the entered details and reveal
  // it in the directory, instead of erroring with "already exists".
  if (existing) {
    const sources = Array.from(new Set([...(((existing.sources as string[]) ?? [])), 'manual']))
    const { data: updated, error: updErr } = await admin
      .from('txt_contacts')
      .update({
        name,
        email,
        notes,
        phone_digits: phoneE164.replace(/\D/g, '').slice(-10),
        sources,
        manually_edited: true,
        in_directory: true,
      })
      .eq('id', existing.id)
      .select('id, name, phone, email, notes, do_not_text, jobber_client_id')
      .single()
    if (updErr || !updated) {
      return NextResponse.json(
        { error: updErr?.message || 'Contact update failed' },
        { status: 500 }
      )
    }
    return NextResponse.json({ contact: updated }, { status: 200 })
  }

  const { data: created, error: createErr } = await admin
    .from('txt_contacts')
    .insert({
      company_id: HEROES_COMPANY_ID,
      phone: phoneE164,
      phone_digits: phoneE164.replace(/\D/g, '').slice(-10),
      name,
      email,
      notes,
      sources: ['manual'],
      manually_edited: true,
    })
    .select('id, name, phone, email, notes, do_not_text, jobber_client_id')
    .single()

  if (createErr || !created) {
    return NextResponse.json(
      { error: createErr?.message || 'Contact insert failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({ contact: created }, { status: 201 })
}
