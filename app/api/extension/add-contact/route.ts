import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/twilio'
import {
  authenticateExtensionRequest,
  EXTENSION_CORS_HEADERS,
  extensionPreflight,
} from '@/lib/extension-auth'

// POST /api/extension/add-contact  (token-gated)
// Body: { name?, first_name?, last_name?, phone?, email?, company?, source_url? }
// Returns: { contact_id, created, existing_conversation_id }
//
// Adds one scanned contact to the unified directory (txt_contacts). Mirrors the
// match precedence of syncLeadToDirectory: phone (last 10) → email → insert.
//
// CONSENT (Chrome Extension PRD §4.3.1): a human triggers every add, and teams
// commonly have verbal consent — so extension contacts are textable by default
// (do_not_text=false), same as leads and Jobber sync. Compliance is the
// subscribing company's responsibility, not a default this tool enforces. This
// holds for every tenant — nothing Heroes-specific here.

function tenDigits(phone: string | null): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  return d.length === 10 || d.length === 11 ? d.slice(-10) : null
}

export function OPTIONS() {
  return extensionPreflight()
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: EXTENSION_CORS_HEADERS })
}

export async function POST(request: Request) {
  const auth = await authenticateExtensionRequest(request)
  if (!auth) return json({ error: 'Unauthorized' }, 401)
  const { companyId } = auth

  const body = await request.json().catch(() => ({}))
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const first = s(body.first_name)
  const last = s(body.last_name)
  const email = s(body.email)
  const company = s(body.company)
  const e164 = toE164(s(body.phone) || '')
  const ten = tenDigits(e164)
  const name = s(body.name) || [first, last].filter(Boolean).join(' ') || email || e164 || null

  if (!e164 && !email) {
    return json({ error: 'A phone or email is required' }, 400)
  }

  const admin = createAdminClient()

  // 1) Locate an existing directory row: phone (last 10) → email.
  let existingId: string | null = null
  if (ten) {
    const { data } = await admin
      .from('txt_contacts')
      .select('id')
      .eq('company_id', companyId)
      .in('phone_digits', [ten, '1' + ten])
      .limit(1)
      .maybeSingle()
    if (data) existingId = data.id as string
  }
  if (!existingId && email) {
    const { data } = await admin
      .from('txt_contacts')
      .select('id')
      .eq('company_id', companyId)
      .ilike('email', email)
      .limit(1)
      .maybeSingle()
    if (data) existingId = data.id as string
  }

  let contactId: string
  let created = false

  if (existingId) {
    // Enrich in place: reveal in the directory, add the 'extension' source, fill
    // blanks, adopt phone/email only when free. Never overwrite hand-edited core
    // fields (mirrors the directory sync).
    const { data: cur } = await admin
      .from('txt_contacts')
      .select('sources, manually_edited, first_name, last_name, company_name, email, phone')
      .eq('id', existingId)
      .single()

    const update: Record<string, unknown> = {
      sources: Array.from(new Set([...((cur?.sources as string[]) ?? []), 'extension'])),
      in_directory: true,
      updated_at: new Date().toISOString(),
    }
    if (!cur?.manually_edited) {
      if (!cur?.first_name && first) update.first_name = first
      if (!cur?.last_name && last) update.last_name = last
      if (!cur?.company_name && company) update.company_name = company
    }
    if (!cur?.phone && e164) {
      const { count } = await admin
        .from('txt_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .in('phone_digits', [ten!, '1' + ten!])
        .neq('id', existingId)
      if (!count) { update.phone = e164; update.phone_digits = ten }
    }
    if (!cur?.email && email) {
      const { count } = await admin
        .from('txt_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .ilike('email', email)
        .neq('id', existingId)
      if (!count) update.email = email
    }
    await admin.from('txt_contacts').update(update).eq('id', existingId)
    contactId = existingId
  } else {
    const { data: createdRow, error } = await admin
      .from('txt_contacts')
      .insert({
        company_id: companyId,
        name: name || 'Unknown',
        first_name: first,
        last_name: last,
        company_name: company,
        phone: e164,
        phone_digits: ten,
        email,
        email_status: email ? 'subscribed' : null,
        do_not_text: false,
        in_directory: true,
        sources: ['extension'],
        manually_edited: false,
      })
      .select('id')
      .single()
    if (error || !createdRow) {
      return json({ error: error?.message || 'Contact insert failed' }, 500)
    }
    contactId = createdRow.id as string
    created = true
  }

  // Tell the extension whether a direct thread already exists, so "Text" can jump
  // straight in without a redundant find-or-create round-trip.
  let existingConversationId: string | null = null
  {
    const { data: conv } = await admin
      .from('txt_conversations')
      .select('id')
      .eq('company_id', companyId)
      .eq('contact_id', contactId)
      .eq('kind', 'direct')
      .maybeSingle()
    existingConversationId = conv?.id ?? null
  }

  return json({
    contact_id: contactId,
    created,
    existing_conversation_id: existingConversationId,
  })
}
