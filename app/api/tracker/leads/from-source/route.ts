import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/twilio'
import { syncLeadToDirectory } from '@/lib/contacts-directory'
import { leadStageIsClosed } from '@/lib/tracker/lead-stage'

// Add-to-Lead-Tracker from a Txt conversation or a Call Log entry.
//
//   POST /api/tracker/leads/from-source   → create the lead
//   GET  /api/tracker/leads/from-source?source_type=txt|call&source_id=…
//                                         → the most recent lead from this source
//
// Same shape as a manual New Lead / the Angi webhook: a `leads` row + a first
// `lead_notes` row + a best-effort directory sync. The lead is tied back to its
// origin via external_lead_id = `${source_type}:${source_id}` — reusing the
// partial unique index (company_id, external_lead_id) the Angi webhook relies on.
//
// Per Ben (Jul 10 2026): clicking the button creates a fresh lead — no "already a
// customer" guard; and Lead Source is left BLANK (null) so the source taxonomy +
// churn reporting stay clean (set it in the tracker afterward if it's known).
//
// ⚠ REPEAT CUSTOMERS (Aug 13 2026) — a Txt conversation is find-or-create per
// contact, so its id is PERMANENT. Keying idempotency on that id alone meant a
// customer who came in as a lead months ago and texts again about a NEW job hit
// "already in the Lead Tracker" forever: double-click protection had quietly
// become a wall. Now:
//
//   • prior lead CLOSED   → a new lead is created, no extra clicks (the common
//                           returning-customer case — 661 of 770 Heroes leads
//                           are in a closed stage).
//   • prior lead OPEN     → still warns (you'd be duplicating live work), but the
//                           caller can pass force:true to add one anyway.
//   • same-second retries → still collapse to one lead, since an unforced POST
//                           with an open prior returns that prior.
//
// The 2nd+ lead from one source takes a `#n` suffix so the unique index still
// holds and the origin stays traceable.
//
// Gated on can_access_tracker (or admin) — the same gate as the Lead Tracker page.

type SourceType = 'txt' | 'call'

function validSource(v: unknown): v is SourceType {
  return v === 'txt' || v === 'call'
}

function externalId(sourceType: SourceType, sourceId: string) {
  return `${sourceType}:${sourceId}`
}

// LIKE wildcards in the prefix. Source ids are uuids today (no % or _), but the
// escape keeps this correct if a future source type carries freer text.
function escapeLike(v: string) {
  return v.replace(/[\\%_]/g, '\\$&')
}

type LeadRow = {
  id: string
  first_name: string | null
  last_name: string | null
  stage: string | null
  external_lead_id: string | null
}

// Every lead spawned by this source: the base key plus any `#n` suffixes.
// Ordered newest-first. A uuid can't be a prefix of a different uuid, so the
// prefix match can't stray into another conversation/call.
async function leadsForSource(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  base: string,
): Promise<LeadRow[]> {
  const { data } = await admin
    .from('leads')
    .select('id, first_name, last_name, stage, external_lead_id')
    .eq('company_id', companyId)
    .like('external_lead_id', `${escapeLike(base)}%`)
    .order('created_at', { ascending: false })
  return (data as LeadRow[] | null) ?? []
}

// Next free key for this source: `base`, then `base#2`, `base#3`… Derived from
// the highest suffix in use rather than the row count, so a deleted lead can't
// hand out a key that's already taken.
function nextKey(base: string, existing: LeadRow[]): string {
  let max = 0
  for (const row of existing) {
    const key = row.external_lead_id
    if (!key) continue
    if (key === base) {
      max = Math.max(max, 1)
      continue
    }
    if (key.startsWith(`${base}#`)) {
      const n = Number(key.slice(base.length + 1))
      if (Number.isInteger(n) && n > 0) max = Math.max(max, n)
    }
  }
  return max === 0 ? base : `${base}#${max + 1}`
}

function leadName(row: LeadRow): string | null {
  return [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || null
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
  const rows = await leadsForSource(admin, g.companyId, externalId(sourceType, sourceId))
  const latest = rows[0]

  if (!latest) {
    return NextResponse.json({ lead_id: null, name: null, stage: null, closed: false, count: 0 })
  }

  // `lead_id` stays the "this source is linked" signal every caller already
  // keys off; `closed` tells the UI whether that link should still block a
  // second lead.
  return NextResponse.json({
    lead_id: latest.id,
    name: leadName(latest),
    stage: latest.stage,
    closed: leadStageIsClosed(latest.stage),
    count: rows.length,
  })
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
  // Set by the UI once the user has SEEN that a prior lead exists and chosen to
  // add another anyway. Without it an open prior lead still short-circuits, which
  // is what keeps a double-click from making two cards.
  const force = body.force === true
  const base = externalId(sourceType, sourceId)

  const admin = createAdminClient()

  let rows = await leadsForSource(admin, companyId, base)
  const latest = rows[0]
  if (latest && !force && !leadStageIsClosed(latest.stage)) {
    return NextResponse.json({
      lead_id: latest.id,
      created: false,
      existing: true,
      closed: false,
    })
  }

  // Insert, retrying once if another writer claimed our key in between.
  let lead: { id: string } | null = null
  let lastError: { message?: string } | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await admin
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
        external_lead_id: nextKey(base, rows),
      })
      .select('id')
      .single()

    if (data) {
      lead = data
      break
    }
    lastError = error
    if ((error as { code?: string } | null)?.code !== '23505') break
    rows = await leadsForSource(admin, companyId, base)
  }

  if (!lead) {
    return NextResponse.json(
      { error: lastError?.message || 'Lead create failed' },
      { status: 500 },
    )
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
