// Angi lead → Txt Queue auto-responder.
//
// When a NEW Angi lead arrives (app/api/webhooks/angi), work it in the Txt
// inbox the same way a Google LSA message lead is worked: the customer gets an
// immediate text signed as the AI persona (Amber), the Angi write-up (service,
// comments, questionnaire, fee) is pinned to the thread as an internal note, and
// the thread is left UNASSIGNED so it shows in the Queue for whoever picks it
// up. Ownership rules mirror inbound texts: an open thread that already has an
// owner keeps that owner; an archived thread is reopened clean into the Queue.
//
// Best-effort end to end — a texting hiccup must never fail the lead ingest.

import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/twilio'
import { sendDirectTxtMessage } from '@/lib/txt-send'
import { getAiTextBotUserId } from '@/lib/ai-text-identity'

type Admin = ReturnType<typeof createAdminClient>

export type AngiAutoTextInput = {
  phone: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  service: string | null
  /** The same write-up saved as the lead's first tracker note. */
  note: string
}

export function buildAngiAutoTextBody(firstName: string | null, service: string | null): string {
  const hi = firstName ? `Hi ${firstName}, ` : 'Hi, '
  const svc = service ? ` for ${service}` : ''
  return (
    `${hi}this is Amber with Heroes Lawn Care — we just got your Angi request${svc}. ` +
    `Reply here with any details or questions, and a team member will follow up shortly to get you scheduled.`
  )
}

export async function angiAutoText(
  admin: Admin,
  companyId: string,
  lead: AngiAutoTextInput,
): Promise<{ ok: boolean; conversation_id?: string; skipped?: string; error?: string }> {
  const e164 = toE164(lead.phone || '')
  if (!e164) return { ok: false, skipped: 'no_phone' }

  const botUserId = await getAiTextBotUserId(admin, companyId)
  if (!botUserId) return { ok: false, skipped: 'no_text_bot_user' }

  // ── Contact: adopt an existing one by phone, else create ───────────────────
  type Contact = { id: string; phone: string | null; name: string | null; do_not_text: boolean }
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim()
  let contact: Contact | null = null

  const { data: existing } = await admin
    .from('txt_contacts')
    .select('id, phone, name, do_not_text, email, first_name, last_name')
    .eq('company_id', companyId)
    .eq('phone', e164)
    .maybeSingle()

  if (existing) {
    contact = existing as Contact
    // Fill in blanks from Angi without overwriting a real name/email.
    const patch: Record<string, unknown> = {}
    const placeholder = !existing.name || existing.name === e164 || existing.name === existing.phone
    if (placeholder && fullName) {
      patch.name = fullName
      patch.first_name = lead.firstName
      patch.last_name = lead.lastName
      contact.name = fullName
    }
    if (!existing.email && lead.email) patch.email = lead.email
    if (Object.keys(patch).length) {
      await admin.from('txt_contacts').update(patch).eq('id', existing.id)
    }
  } else {
    const { data: created, error } = await admin
      .from('txt_contacts')
      .insert({
        company_id: companyId,
        phone: e164,
        phone_digits: e164.replace(/\D/g, '').slice(-10),
        name: fullName || e164,
        first_name: lead.firstName,
        last_name: lead.lastName,
        email: lead.email,
        do_not_text: false,
        in_directory: true,
        sources: ['angi'],
      })
      .select('id, phone, name, do_not_text')
      .single()
    if (error || !created) return { ok: false, error: error?.message || 'contact create failed' }
    contact = created as Contact
  }

  // ── Conversation: unassigned Queue item (keep an existing owner) ───────────
  const now = new Date().toISOString()
  let conversationId: string
  let keepOwner = false
  const { data: conv } = await admin
    .from('txt_conversations')
    .select('id, status, assigned_to')
    .eq('company_id', companyId)
    .eq('contact_id', contact.id)
    .eq('kind', 'direct')
    .maybeSingle()

  if (conv) {
    conversationId = conv.id as string
    if (conv.status === 'archived') {
      await admin
        .from('txt_conversations')
        .update({ status: 'unassigned', assigned_to: null, archived_by: null, last_inbound_at: now })
        .eq('id', conversationId)
      await admin.from('txt_conversation_members').delete().eq('conversation_id', conversationId)
    } else {
      keepOwner = Boolean(conv.assigned_to)
      // Bump the inbound marker so an open thread sorts up like a fresh lead.
      await admin.from('txt_conversations').update({ last_inbound_at: now }).eq('id', conversationId)
    }
  } else {
    const { data: created, error } = await admin
      .from('txt_conversations')
      .insert({
        company_id: companyId,
        contact_id: contact.id,
        kind: 'direct',
        status: 'unassigned',
        source: 'angi',
        last_message_at: now,
        last_inbound_at: now,
        last_message_preview: `📥 Angi lead${lead.service ? ` — ${lead.service}` : ''}`,
        last_message_direction: 'inbound',
      })
      .select('id')
      .single()
    if (error || !created) return { ok: false, error: error?.message || 'conversation create failed' }
    conversationId = created.id as string
  }

  // ── Internal note: the Angi write-up, on the thread ────────────────────────
  await admin.from('txt_notes').insert({
    company_id: companyId,
    conversation_id: conversationId,
    body: lead.note,
    created_by: botUserId,
  })

  // ── Auto-responder, signed as Amber ────────────────────────────────────────
  let sendError: string | undefined
  if (contact.do_not_text) {
    sendError = 'do_not_text'
  } else {
    const res = await sendDirectTxtMessage({
      admin,
      companyId,
      conversationId,
      contact,
      userId: botUserId,
      body: buildAngiAutoTextBody(lead.firstName, lead.service),
    })
    if (!res.ok) sendError = res.error
    else {
      await admin.from('txt_messages').update({ is_ai: true }).eq('id', res.message_id as string)
    }
  }

  // sendDirectTxtMessage stamps the thread "outbound"; a fresh Angi lead should
  // read like an inbound item in the Queue (unassigned, unread), so restore that
  // — unless a teammate already owns the thread.
  if (!keepOwner) {
    await admin
      .from('txt_conversations')
      .update({ status: 'unassigned', assigned_to: null, last_message_direction: 'inbound', last_inbound_at: now })
      .eq('id', conversationId)
  }

  // Light the Queue for managers/triage (same audience as inbound texts).
  try {
    const { data: managers } = await admin
      .from('user_profiles')
      .select('id, role, can_admin_txt, can_assign_txt_threads')
      .eq('company_id', companyId)
    const recipientIds = (managers ?? [])
      .filter((m) => m.role === 'admin' || m.can_admin_txt === true || m.can_assign_txt_threads === true)
      .map((m) => m.id)
    const channel = admin.channel(`txt:${companyId}`)
    await channel.subscribe()
    await channel.send({
      type: 'broadcast',
      event: 'inbound',
      payload: { conversation_id: conversationId, contact_id: contact.id, recipient_ids: recipientIds },
    })
    await admin.removeChannel(channel)
  } catch (e) {
    console.warn('[angi-auto-text] broadcast failed', e)
  }

  return sendError ? { ok: false, conversation_id: conversationId, error: sendError } : { ok: true, conversation_id: conversationId }
}
