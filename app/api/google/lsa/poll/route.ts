import { NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchNewLsaLeads, googleAdsConfigured, type LsaLead } from '@/lib/google-ads'
import { syncLeadToDirectory } from '@/lib/contacts-directory'
import { broadcastMessageInserted } from '@/lib/hub-message-broadcast'

// Google Local Services Ads (LSA) lead poller.
//
// Cron-driven (every ~5 min, prod only — staging+prod share the DB, so a single
// cron avoids double-polling). For each company with an LSA-enabled Google
// connection + a customer id, it pulls new local_services_lead rows via the
// Google Ads API and drops each into the SAME destination as the Angi webhook:
// a `leads` row (Lead Tracker) + first note + unified contacts directory + an
// office-room alert. Ingest only — no texting in v1 (drip is a later phase).
//
// Idempotent: reuses Angi's mechanism — the Google lead id is stored in
// leads.external_lead_id with a `glsa_` prefix (can't collide with Angi ids).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const GUARDIAN_BOT_ID = '00000000-0000-0000-0001-000000000001'
const OFFICE_ROOM_ID = 'cebac7e5-caf8-400c-a15d-5eb9d81e1967'
// Matches the existing Lead Tracker "Lead Source" dropdown option so the cell
// shows selected (same trick as the Angi webhook's 'Angi Lead').
const LEAD_SOURCE = process.env.GLSA_LEAD_SOURCE || 'Google (GBP / LSA)'

function authed(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (
    req.headers.get('x-cron-secret') === secret ||
    req.headers.get('authorization') === `Bearer ${secret}`
  )
}

function formatPhone(raw: string | null): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  const ten = d.length >= 10 ? d.slice(-10) : ''
  if (!ten) return raw && raw.trim() ? raw.trim() : null
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
}

function splitName(name: string | null): { first: string | null; last: string | null } {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { first: null, last: null }
  return { first: parts[0], last: parts.slice(1).join(' ') || null }
}

function buildNote(lead: LsaLead): string {
  const lines: string[] = ['📥 New Google Local Services lead']
  const meta: string[] = []
  if (lead.leadType) meta.push(`Lead type: ${lead.leadType.replace(/_/g, ' ').toLowerCase()}`)
  if (lead.categoryId) meta.push(`Category: ${lead.categoryId}`)
  if (lead.serviceId) meta.push(`Service: ${lead.serviceId}`)
  if (lead.leadStatus) meta.push(`Status: ${lead.leadStatus.replace(/_/g, ' ').toLowerCase()}`)
  if (lead.creationDateTime) meta.push(`Received: ${lead.creationDateTime}`)
  meta.push(`Google lead ID: ${lead.id}`)
  if (meta.length) lines.push('', meta.join(' · '))
  return lines.join('\n')
}

// GET = health/config probe (used by the post-deploy live check).
export async function GET() {
  return NextResponse.json({ ok: true, configured: googleAdsConfigured() })
}

export async function POST(req: Request) {
  if (!authed(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!googleAdsConfigured()) {
    // Developer token not set yet — nothing to poll. Return 200 (not 503) so the
    // every-5-min cron stays quiet until Google Ads is configured.
    return NextResponse.json({ ok: true, skipped: 'not_configured', totalNew: 0 })
  }

  const admin = createAdminClient()

  // Companies with an LSA-enabled Google connection and a customer id set.
  const { data: conns } = await admin
    .from('google_connections')
    .select('company_id')
    .eq('lsa_enabled', true)
    .not('customer_id', 'is', null)

  let totalNew = 0
  const results: Array<Record<string, unknown>> = []

  for (const { company_id: companyId } of (conns ?? []) as { company_id: string }[]) {
    const fetched = await fetchNewLsaLeads(admin, companyId)
    if (!fetched) {
      results.push({ companyId, skipped: true })
      continue
    }

    let created = 0
    for (const lead of fetched.leads) {
      const externalId = `glsa_${lead.id}`

      const { data: dup } = await admin
        .from('leads')
        .select('id')
        .eq('company_id', companyId)
        .eq('external_lead_id', externalId)
        .maybeSingle()
      if (dup) continue

      const { first, last } = splitName(lead.consumerName)
      const phone = formatPhone(lead.phone)

      const { data: row, error } = await admin
        .from('leads')
        .insert({
          company_id: companyId,
          first_name: first,
          last_name: last,
          phone,
          email: lead.email,
          lead_source: LEAD_SOURCE,
          status: 'Current',
          stage: 'current',
          external_lead_id: externalId,
        })
        .select('id')
        .single()

      if (error) {
        // Unique violation on (company_id, external_lead_id) = a race; treat as dup.
        if ((error as { code?: string }).code === '23505') continue
        console.error(`[lsa-poll] insert failed (${companyId}, lead ${lead.id}):`, error.message)
        continue
      }

      created++
      totalNew++

      await admin.from('lead_notes').insert({
        lead_id: row.id,
        company_id: companyId,
        note: buildNote(lead),
        created_by: 'Google LSA',
      })

      // Office-room alert so someone works the lead fast (speed-to-lead).
      // Best-effort — a messaging hiccup must never fail the ingest.
      try {
        const leadName = [first, last].filter(Boolean).join(' ') || 'Unknown name'
        const line2 = [phone, lead.leadType && `(${lead.leadType.replace(/_/g, ' ').toLowerCase()})`]
          .filter(Boolean)
          .join(' ')
        const content = `📥 New Google LSA lead: ${leadName}${line2 ? `\n${line2}` : ''}\nOpen the Lead Tracker → /hub/tracker`
        const { data: alertMsg } = await admin
          .from('messages')
          .insert({ company_id: companyId, room_id: OFFICE_ROOM_ID, sender_id: GUARDIAN_BOT_ID, content })
          .select('id')
          .single()
        if (alertMsg) {
          after(() =>
            broadcastMessageInserted({
              messageId: alertMsg.id,
              roomId: OFFICE_ROOM_ID,
              conversationId: null,
              parentId: null,
              senderId: GUARDIAN_BOT_ID,
            }),
          )
        }
      } catch (e) {
        console.error('[lsa-poll] office-room alert failed:', (e as Error).message)
      }

      // Unified contacts directory (best-effort; never blocks the lead).
      after(() =>
        syncLeadToDirectory(admin, companyId, {
          first_name: first,
          last_name: last,
          phone,
          email: lead.email,
        }).catch(() => {}),
      )
    }

    // Advance the poll cursor to the newest lead time seen this run.
    if (fetched.cursor) {
      await admin
        .from('google_connections')
        .update({ lsa_last_lead_time: fetched.cursor, updated_at: new Date().toISOString() })
        .eq('company_id', companyId)
    }

    results.push({ companyId, fetched: fetched.leads.length, created })
  }

  return NextResponse.json({ ok: true, totalNew, results })
}
