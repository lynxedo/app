import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/twilio'
import { syncLeadToDirectory } from '@/lib/contacts-directory'
import {
  authenticateExtensionRequest,
  EXTENSION_CORS_HEADERS,
  extensionPreflight,
} from '@/lib/extension-auth'

// POST /api/extension/add-lead  (token-gated)
// Body: { name?, first_name?, last_name?, phone?, email?, company?, address?, service?, source_url? }
// Returns: { lead_id, created, existing }
//
// Creates a Lead Tracker lead from a scanned contact — same shape as a manual
// New Lead / the Angi webhook: a `leads` row (stage 'current', status 'Current')
// + a first `lead_notes` row + directory sync. Consent assumed (textable) per
// PRD §4.3.1. Tenant-generic: company comes from the token, nothing hardcoded.

export function OPTIONS() {
  return extensionPreflight()
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...EXTENSION_CORS_HEADERS },
  })
}

export async function POST(request: Request) {
  const auth = await authenticateExtensionRequest(request)
  if (!auth) return json({ error: 'Unauthorized' }, 401)
  const { userId, companyId } = auth

  const body = await request.json().catch(() => ({}))
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const first = s(body.first_name)
  const last = s(body.last_name)
  const nameParts = s(body.name)?.split(/\s+/) ?? []
  const firstName = first || nameParts[0] || null
  const lastName = last || (nameParts.length > 1 ? nameParts.slice(1).join(' ') : null)
  const email = s(body.email)
  const e164 = toE164(s(body.phone) || '')
  const address = s(body.address)
  const svc = s(body.service)
  const sourceUrl = s(body.source_url)

  if (!e164 && !email) return json({ error: 'A phone or email is required' }, 400)

  const admin = createAdminClient()

  // Light dedup on email (the most reliable field) so re-adding the same person
  // doesn't spawn duplicate lead cards. Phone-only dedup is skipped (leads.phone
  // is free-text with variable formatting) — the client also disables the button
  // after a successful add.
  if (email) {
    const { data: dup } = await admin
      .from('leads')
      .select('id')
      .eq('company_id', companyId)
      .ilike('email', email)
      .limit(1)
      .maybeSingle()
    if (dup) return json({ lead_id: dup.id, created: false, existing: true })
  }

  const { data: lead, error } = await admin
    .from('leads')
    .insert({
      company_id: companyId,
      first_name: firstName,
      last_name: lastName,
      phone: e164,
      email,
      service: svc ? [svc] : null,
      lead_source: 'Extension',
      status: 'Current',
      stage: 'current',
      service_address: address,
      lead_creation_date: new Date().toISOString().slice(0, 10),
    })
    .select('id')
    .single()
  if (error || !lead) return json({ error: error?.message || 'Lead create failed' }, 500)

  // First note — who added it + where from.
  const { data: hu } = await admin
    .from('hub_users')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle()
  const addedBy = hu?.display_name || 'Extension'
  const noteLines = [
    'Added from the Lynxedo browser extension.',
    body.company ? `Company: ${s(body.company)}` : null,
    sourceUrl ? `Source: ${sourceUrl}` : null,
  ].filter(Boolean)
  await admin.from('lead_notes').insert({
    lead_id: lead.id,
    company_id: companyId,
    note: noteLines.join('\n'),
    created_by: addedBy,
  })

  // Mirror into the unified directory (source 'leads' → textable, in_directory).
  void syncLeadToDirectory(admin, companyId, {
    first_name: firstName,
    last_name: lastName,
    phone: e164,
    email,
  }).catch(() => {})

  return json({ lead_id: lead.id, created: true, existing: false })
}
