// A new Jobber request (REQUEST_CREATE webhook) → a Lead Tracker card + an
// Office Alerts post (Ben, Oct 19 2026). No customer text: Amber's first text is
// NOT sent for these.
//
// Duplicates, in order:
//  1. The same request again (Jobber retries) — external_lead_id is unique per company.
//  2. An OPEN lead already exists for this phone / email — the request is noted on
//     that lead instead of making a second card. If that lead is brand new (made in
//     the last 30 minutes) it's the same intake — Amber books a caller by creating
//     the Jobber request herself, and her call already posted its own alert — so
//     no second alert either.

import type { SupabaseClient } from '@supabase/supabase-js'
import { jobberGraphQLAdmin } from '@/lib/jobber'
import { postOfficeAlert } from '@/lib/office-alerts'
import { syncLeadToDirectory } from '@/lib/contacts-directory'
import { phoneVariants } from '@/lib/hub-actions/actions-tracker'
import { leadStageIsClosed } from '@/lib/tracker/lead-stage'
import { formatPhone } from '@/lib/format'

type Admin = SupabaseClient

const REQUEST_QUERY = `
  query LynxedoRequestLead($id: EncodedId!) {
    request(id: $id) {
      id
      title
      source
      contactName
      companyName
      phone
      email
      createdAt
      jobberWebUri
      client {
        id
        firstName
        lastName
        companyName
        phones { number primary }
        emails { address primary }
      }
      property {
        address { street1 street2 city province postalCode }
      }
    }
  }
`

type JobberRequest = {
  id: string
  title: string | null
  source: string | null
  contactName: string | null
  companyName: string | null
  phone: string | null
  email: string | null
  createdAt: string
  jobberWebUri: string | null
  client: {
    id: string
    firstName: string | null
    lastName: string | null
    companyName: string | null
    phones: { number: string; primary: boolean }[] | null
    emails: { address: string; primary: boolean }[] | null
  } | null
  property: {
    address: { street1?: string | null; street2?: string | null; city?: string | null; province?: string | null; postalCode?: string | null } | null
  } | null
}

const clean = (v: string | null | undefined) => (v ?? '').trim() || null

// Jobber's request "source" is free text set by where it came from; anything that
// reads like the online request form / client hub is a website lead.
function leadSourceFor(source: string | null): string | null {
  if (!source) return null
  return /online|client.?hub|request.?form|website|web/i.test(source) ? 'Website Visit' : null
}

export async function ingestJobberRequest(
  admin: Admin,
  companyId: string,
  jobberUserId: string,
  requestId: string,
): Promise<string> {
  const externalId = `jobber-request:${requestId}`

  const { data: already } = await admin
    .from('leads')
    .select('id')
    .eq('company_id', companyId)
    .eq('external_lead_id', externalId)
    .maybeSingle()
  if (already) return `duplicate (lead ${already.id})`

  const res = await jobberGraphQLAdmin<{ data?: { request?: JobberRequest | null } }>(
    jobberUserId, REQUEST_QUERY, { id: requestId },
  )
  const r = res?.data?.request
  if (!r) return 'request not found'

  const c = r.client
  const first = clean(c?.firstName) ?? clean(r.contactName)
  const last = clean(c?.lastName)
  const company = clean(c?.companyName) ?? clean(r.companyName)
  const primaryPhone = c?.phones?.find(p => p.primary)?.number ?? c?.phones?.[0]?.number ?? null
  const phone = formatPhone(clean(r.phone) ?? primaryPhone) || null
  const email = clean(r.email) ?? clean(c?.emails?.find(e => e.primary)?.address ?? c?.emails?.[0]?.address)
  const a = r.property?.address
  const service_address = a
    ? [a.street1, a.street2, a.city, a.province, a.postalCode].map(clean).filter(Boolean).join(', ') || null
    : null
  const title = clean(r.title)
  const name = [first, last].filter(Boolean).join(' ') || company || 'Unknown name'

  const note = [
    `📥 Jobber request${title ? `: ${title}` : ''}`,
    r.source ? `Source in Jobber: ${r.source}` : null,
    service_address,
    r.jobberWebUri ? `Open in Jobber: ${r.jobberWebUri}` : null,
  ].filter(Boolean).join('\n')

  // An open lead for the same person gets the note instead of a second card.
  const digits = (phone ?? '').replace(/\D/g, '').slice(-10)
  const matches: { id: string; stage: string | null; created_at: string }[] = []
  if (digits.length === 10) {
    const { data } = await admin.from('leads').select('id, stage, created_at')
      .eq('company_id', companyId).in('phone', phoneVariants(digits))
      .order('created_at', { ascending: false }).limit(10)
    matches.push(...((data ?? []) as typeof matches))
  }
  if (matches.length === 0 && email) {
    const { data } = await admin.from('leads').select('id, stage, created_at')
      .eq('company_id', companyId).ilike('email', email)
      .order('created_at', { ascending: false }).limit(10)
    matches.push(...((data ?? []) as typeof matches))
  }
  const open = matches.find(l => !leadStageIsClosed(l.stage))

  if (open) {
    await admin.from('lead_notes').insert({ lead_id: open.id, company_id: companyId, note, created_by: 'Jobber' })
    const sameIntake = Date.now() - new Date(open.created_at).getTime() < 30 * 60 * 1000
    if (!sameIntake) {
      await postOfficeAlert(admin, companyId, {
        title: `📥 New Jobber request: ${name}${phone ? ` ${phone}` : ''} (already in Lead Tracker)`,
        details: [title && `Request: ${title}`, service_address, r.jobberWebUri && `Open in Jobber → ${r.jobberWebUri}`, 'Lead Tracker → /hub/tracker'],
      })
    }
    return `noted on open lead ${open.id}${sameIntake ? ' (same intake, no alert)' : ''}`
  }

  const { data: lead, error } = await admin
    .from('leads')
    .insert({
      company_id: companyId,
      first_name: first ?? company,
      last_name: last,
      phone,
      email,
      service: title ? [title] : null,
      lead_source: leadSourceFor(r.source),
      status: 'Current',
      stage: 'current',
      service_address,
      external_lead_id: externalId,
    })
    .select('id')
    .single()
  if (error) {
    // Unique violation = a concurrent retry of the same request already made it.
    if ((error as { code?: string }).code === '23505') return 'duplicate (race)'
    throw new Error(`lead insert failed: ${error.message}`)
  }

  await admin.from('lead_notes').insert({ lead_id: lead.id, company_id: companyId, note, created_by: 'Jobber' })

  await postOfficeAlert(admin, companyId, {
    title: `📥 New Jobber request: ${name}${phone ? ` ${phone}` : ''}`,
    details: [title && `Request: ${title}`, service_address, r.jobberWebUri && `Open in Jobber → ${r.jobberWebUri}`, 'Lead Tracker → /hub/tracker'],
  })

  await syncLeadToDirectory(admin, companyId, { first_name: first, last_name: last, phone, email }).catch(() => {})

  return `lead ${lead.id} created`
}
