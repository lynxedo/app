import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractContactName } from '@/lib/contact-name-ai'

export const maxDuration = 300

const HEROES_COMPANY_ID = process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// POST /api/txt/contacts/suggest-names
// Contact Quality Phase 2 — batch AI naming. Finds "Unknown" contacts (name = '')
// that have a real conversation and asks Claude for the customer's name; when it's
// confident it fills the name and marks name_source='ai' (→ purple dot in the UI).
// Never touches a contact that already has a name. Gate: x-cron-secret OR an admin.
// Body: { limit?: number } (default 20, cap 50).
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const isCron = !!cronSecret && request.headers.get('x-cron-secret') === cronSecret

  let companyId = HEROES_COMPANY_ID
  if (!isCron) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, can_admin_txt, company_id')
      .eq('id', user.id)
      .single()
    const isAdmin = profile?.role === 'admin' || profile?.can_admin_txt === true
    if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    companyId = profile?.company_id || HEROES_COMPANY_ID
  }

  const body = await request.json().catch(() => ({}))
  const limit = Math.min(Math.max(parseInt(body.limit, 10) || 20, 1), 50)

  const admin = createAdminClient()

  // Candidates: "Unknown" contacts (blank name) with a phone, most-recently-active first.
  const { data: candidates, error } = await admin
    .from('txt_contacts')
    .select('id, phone')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .eq('name', '')
    .not('phone', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let processed = 0
  let named = 0
  const results: Array<{ id: string; name: string }> = []

  for (const c of candidates ?? []) {
    // Pull the recent thread (both directions) for this contact.
    const { data: msgs } = await admin
      .from('txt_messages')
      .select('direction, body, created_at')
      .eq('company_id', companyId)
      .eq('contact_id', c.id)
      .order('created_at', { ascending: false })
      .limit(20)
    const messages = (msgs ?? []).reverse().map((m) => ({ direction: m.direction, body: m.body }))
    if (messages.length === 0) continue
    processed++

    const guess = await extractContactName(messages)
    if (guess.name && guess.confidence === 'high') {
      // Re-check it's still nameless (avoid clobbering a name added meanwhile).
      const { data: fresh } = await admin
        .from('txt_contacts').select('name').eq('id', c.id).maybeSingle()
      if (fresh && (fresh.name ?? '') === '') {
        await admin
          .from('txt_contacts')
          // Promote-on-name: a named contact belongs in the directory.
          .update({ name: guess.name, name_source: 'ai', in_directory: true, updated_at: new Date().toISOString() })
          .eq('id', c.id)
        named++
        results.push({ id: c.id, name: guess.name })
      }
    }
  }

  return NextResponse.json({ ok: true, processed, named, results })
}
