import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncLeadToDirectory } from '@/lib/contacts-directory'
import { broadcastMessageInserted } from '@/lib/hub-message-broadcast'

// Angi "Standard Lead API" webhook.
//
// Angi POSTs each new lead as JSON directly to this endpoint (no Zapier). Set up
// the endpoint + your Angi account via crmintegrations@angi.com, with auth type
// "Send API Key in Header" (X-API-KEY) matching env ANGI_WEBHOOK_KEY.
//
// Each lead becomes a row in the Hub Lead Tracker (`leads`, stage 'current',
// lead_source 'Angi') plus the unified contacts directory, with the questionnaire
// + comments captured as the lead's first note. Idempotent on Angi's leadOid via
// leads.external_lead_id (Angi re-POSTs the same lead on retry).

export const runtime = 'nodejs'

const HEROES_COMPANY_ID = '00000000-0000-0000-0000-000000000002'
// Guardian/Claude bot (posts system messages) + the Hub "office" room.
const GUARDIAN_BOT_ID = '00000000-0000-0000-0001-000000000001'
const OFFICE_ROOM_ID = 'cebac7e5-caf8-400c-a15d-5eb9d81e1967'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return v == null ? null : String(v)
  const t = v.trim()
  return t === '' ? null : t
}

function formatPhone(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  const ten = d.length >= 10 ? d.slice(-10) : ''
  if (!ten) return clean(raw)
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
}

type AngiInterview = { question?: string; answer?: string }
type AngiLead = {
  name?: string
  firstName?: string
  lastName?: string
  address?: string
  city?: string
  stateProvince?: string
  postalCode?: string
  primaryPhone?: string
  secondaryPhone?: string
  email?: string
  leadOid?: string | number
  srOid?: string | number
  fee?: number | string
  taskName?: string
  comments?: string
  matchType?: string
  leadDescription?: string
  leadSource?: string
  interview?: AngiInterview[]
  primaryPhoneDetails?: { maskedNumber?: boolean }
}

function splitName(l: AngiLead): { first: string | null; last: string | null } {
  const first = clean(l.firstName)
  const last = clean(l.lastName)
  if (first || last) return { first, last }
  const parts = (clean(l.name) || '').split(/\s+/).filter(Boolean)
  if (!parts.length) return { first: null, last: null }
  return { first: parts[0], last: parts.slice(1).join(' ') || null }
}

function buildNote(l: AngiLead): string {
  const lines: string[] = ['📥 New Angi lead']
  const svc = clean(l.taskName)
  if (svc) lines.push('', `Service requested: ${svc}`)
  const comments = clean(l.comments)
  if (comments) lines.push('', `Customer comments: ${comments}`)
  const interview = Array.isArray(l.interview) ? l.interview : []
  const qa = interview
    .map((i) => ({ q: clean(i.question), a: clean(i.answer) }))
    .filter((i) => i.q)
  if (qa.length) {
    lines.push('', 'Angi questionnaire:')
    for (const i of qa) lines.push(`• ${i.q}: ${i.a ?? '—'}`)
  }
  const meta: string[] = []
  const fee = l.fee != null && String(l.fee).trim() !== '' ? `$${l.fee}` : null
  if (fee) meta.push(`Angi lead fee: ${fee}`)
  if (clean(l.matchType)) meta.push(`Match type: ${clean(l.matchType)}`)
  if (clean(l.leadDescription)) meta.push(clean(l.leadDescription) as string)
  const second = formatPhone(l.secondaryPhone)
  if (second) meta.push(`Secondary phone: ${second}`)
  if (l.primaryPhoneDetails?.maskedNumber) meta.push('⚠ Angi-masked phone number')
  if (l.leadOid != null) meta.push(`Angi lead ID: ${l.leadOid}`)
  if (meta.length) lines.push('', meta.join(' · '))
  return lines.join('\n')
}

// GET = health/config probe (used by the post-deploy live check).
export async function GET() {
  return NextResponse.json({ ok: true, configured: Boolean(process.env.ANGI_WEBHOOK_KEY) })
}

export async function POST(request: Request) {
  const key = process.env.ANGI_WEBHOOK_KEY
  if (!key) {
    // Not wired yet (e.g. staging before the env var is set). Be explicit
    // rather than silently accepting unauthenticated leads.
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 })
  }
  const provided = request.headers.get('x-api-key') ?? ''
  if (!provided || !safeEqual(provided, key)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: AngiLead
  try {
    body = (await request.json()) as AngiLead
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  const admin = createAdminClient()
  const externalId = body.leadOid != null ? String(body.leadOid) : null

  // Idempotency: Angi re-POSTs the same lead on retry.
  if (externalId) {
    const { data: dup } = await admin
      .from('leads')
      .select('id')
      .eq('company_id', HEROES_COMPANY_ID)
      .eq('external_lead_id', externalId)
      .maybeSingle()
    if (dup) return NextResponse.json({ ok: true, duplicate: true, lead_id: dup.id })
  }

  const { first, last } = splitName(body)
  const phone = formatPhone(body.primaryPhone)
  const email = clean(body.email)
  const addressParts = [body.address, body.city, body.stateProvince, body.postalCode]
    .map(clean)
    .filter(Boolean)
  const service_address = addressParts.length ? addressParts.join(', ') : null
  const svc = clean(body.taskName)

  const insertRow = {
    company_id: HEROES_COMPANY_ID,
    first_name: first,
    last_name: last,
    phone,
    email,
    service: svc ? [svc] : null,
    lead_source: 'Angi Lead', // matches the Lead Source dropdown option so the cell shows selected
    status: 'Current',
    stage: 'current',
    service_address,
    external_lead_id: externalId,
  }

  const { data: lead, error } = await admin
    .from('leads')
    .insert(insertRow)
    .select('id')
    .single()

  if (error) {
    // Unique violation on (company_id, external_lead_id) = a race with a retry.
    if ((error as { code?: string }).code === '23505' && externalId) {
      const { data: existing } = await admin
        .from('leads')
        .select('id')
        .eq('company_id', HEROES_COMPANY_ID)
        .eq('external_lead_id', externalId)
        .maybeSingle()
      if (existing) return NextResponse.json({ ok: true, duplicate: true, lead_id: existing.id })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // First note: the Angi questionnaire + comments + fee/meta.
  await admin.from('lead_notes').insert({
    lead_id: lead.id,
    company_id: HEROES_COMPANY_ID,
    note: buildNote(body),
    created_by: 'Angi',
  })

  // Alert the Hub "office" room so someone works the lead fast (speed-to-lead).
  // Best-effort — a messaging hiccup must never fail the lead ingest.
  try {
    const leadName = [first, last].filter(Boolean).join(' ') || 'Unknown name'
    const line2 = [svc && `Service: ${svc}`, phone, service_address].filter(Boolean).join(' · ')
    const content = `📥 New Angi lead: ${leadName}${line2 ? `\n${line2}` : ''}\nOpen the Lead Tracker → /hub/tracker`
    const { data: alertMsg } = await admin
      .from('messages')
      .insert({ company_id: HEROES_COMPANY_ID, room_id: OFFICE_ROOM_ID, sender_id: GUARDIAN_BOT_ID, content })
      .select('id')
      .single()
    if (alertMsg) {
      void broadcastMessageInserted({
        messageId: alertMsg.id, roomId: OFFICE_ROOM_ID, conversationId: null, parentId: null, senderId: GUARDIAN_BOT_ID,
      })
    }
  } catch (e) {
    console.error('[angi] office-room alert failed:', (e as Error).message)
  }

  // (Email displays via the built-in Email column in the Lead Tracker as of
  // July 2026. The old fill of a custom "Email" column was removed once that
  // built-in column shipped and the redundant custom column was retired.)

  // Add to the unified contacts directory (best-effort; never blocks the lead).
  void syncLeadToDirectory(admin, HEROES_COMPANY_ID, {
    first_name: first,
    last_name: last,
    phone,
    email,
  }).catch(() => {})

  return NextResponse.json({ ok: true, lead_id: lead.id })
}
