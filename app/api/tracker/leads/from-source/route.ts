import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/twilio'
import { syncLeadToDirectory } from '@/lib/contacts-directory'

// Add-to-Lead-Tracker from a Txt conversation or a Call Log entry.
//
//   POST /api/tracker/leads/from-source   → create the lead
//   GET  /api/tracker/leads/from-source?source_type=txt|call&source_id=…
//                                         → { lead_id } if this source is already a lead
//
// Same shape as a manual New Lead / the Angi webhook: a `leads` row + a first
// `lead_notes` row + a best-effort directory sync. The lead is tied back to its
// origin via external_lead_id = `${source_type}:${source_id}` — reusing the exact
// idempotency key + partial unique index (company_id, external_lead_id) the Angi
// webhook already relies on. That guarantees the same text/call can only ever
// spawn ONE lead (re-clicking returns the existing one), and lets the UI flip its
// button to "In tracker".
//
// Per Ben (Jul 10 2026): clicking the button ALWAYS creates a fresh lead — no
// "already a customer / already a lead" guard beyond same-source idempotency; and
// Lead Source is left BLANK (null) so the source taxonomy + churn reporting stay
// clean (set it in the tracker afterward if it's known).
//
// Gated on can_access_tracker (or admin) — the same gate as the Lead Tracker page.

type SourceType = 'txt' | 'call'

function validSource(v: unknown): v is SourceType {
  return v === 'txt' || v === 'call'
}

function externalId(sourceType: SourceType, sourceId: string) {
  return `${sourceType}:${sourceId}`
}

async function gate() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_access_tracker')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id) return { error: 'No company', status: 403 as const }
  const allowed = profile.role === 'admin' || profile.can_access_tracker === true
  if (!allowed) {
    return { error: 'This account is not enabled for the Lead Tracker.', status: 403 as const }
  }
  return { user, companyId: profile.company_id as string }
}

export async function GET(request: Request) {
  const g = await gate()
  if ('error' in g) return NextResponse.json({ error: g.error }, { status: g.status })

  const { searchParams } = new URL(request.url)
  const sourceType = searchParams.get('source_type')
  const sourceId = searchParams.get('source_id')
  if (!validSource(sourceType) || !sourceId) {
    return NextResponse.json(
      { error: 'source_type (txt|call) and source_id are required' },
      { status: 400 },
    )
  }

  const admin = createAdminClient()
  const { data: lead } = await admin
    .from('leads')
    .select('id, first_name, last_name')
    .eq('company_id', g.companyId)
    .eq('external_lead_id', externalId(sourceType, sourceId))
    .maybeSingle()

  if (!lead) return NextResponse.json({ lead_id: null })
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null
  return NextResponse.json({ lead_id: lead.id, name })
}

export async function POST(request: Request) {
  const g = await gate()
  if ('error' in g) return NextResponse.json({ error: g.error }, { status: g.status })
  const { user, companyId } = g

  const body = await request.json().catch(() => ({}))
  const sourceType = body.source_type
  const sourceId = typeof body.source_id === 'string' ? body.source_id.trim() : ''
  if (!validSource(sourceType) || !sourceId) {
    return NextResponse.json(
      { error: 'source_type (txt|call) and source_id are required' },
      { status: 400 },
    )
  }

  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const nameParts = s(body.name)?.split(/\s+/) ?? []
  const firstName = nameParts[0] || null
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null
  const rawPhone = s(body.phone)
  const phone = rawPhone ? toE164(rawPhone) || rawPhone : null
  const email = s(body.email)
  const serviceAddress = s(body.service_address)
  const stage = s(body.stage) || 'current'
  const note = s(body.note)
  const extId = externalId(sourceType, sourceId)

  const admin = createAdminClient()

  // Same-source idempotency: one text/call → one lead. Re-adding returns the
  // existing lead instead of a duplicate card.
  const { data: dup } = await admin
    .from('leads')
    .select('id')
    .eq('company_id', companyId)
    .eq('external_lead_id', extId)
    .maybeSingle()
  if (dup) return NextResponse.json({ lead_id: dup.id, created: false, existing: true })

  const { data: lead, error } = await admin
    .from('leads')
    .insert({
      company_id: companyId,
      first_name: firstName,
      last_name: lastName,
      phone,
      email,
      lead_source: null, // left blank per Ben — set it in the tracker if known
      status: 'Current',
      stage,
      service_address: serviceAddress,
      lead_creation_date: new Date().toISOString().slice(0, 10),
      external_lead_id: extId,
    })
    .select('id')
    .single()

  if (error || !lead) {
    // Unique-violation race with a double-click → return the row that won.
    if ((error as { code?: string } | null)?.code === '23505') {
      const { data: existing } = await admin
        .from('leads')
        .select('id')
        .eq('company_id', companyId)
        .eq('external_lead_id', extId)
        .maybeSingle()
      if (existing) return NextResponse.json({ lead_id: existing.id, created: false, existing: true })
    }
    return NextResponse.json({ error: error?.message || 'Lead create failed' }, { status: 500 })
  }

  if (note) {
    const { data: hu } = await admin
      .from('hub_users')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()
    const addedBy = hu?.display_name || user.email?.split('@')[0] || 'Hub'
    await admin.from('lead_notes').insert({
      lead_id: lead.id,
      company_id: companyId,
      note,
      created_by: addedBy,
    })
  }

  // Mirror into the unified contacts directory (source 'leads'). Best-effort;
  // after() so it's guaranteed to run post-response.
  after(() =>
    syncLeadToDirectory(admin, companyId, {
      first_name: firstName,
      last_name: lastName,
      phone,
      email,
    }).catch(() => {}),
  )

  return NextResponse.json({ lead_id: lead.id, created: true, existing: false })
}
