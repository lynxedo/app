// Shared direct (1-to-1) Txt send. Composes the final body (template render +
// signature + first-message opt-out notice) exactly like the interactive send
// route, inserts the txt_messages row, sends via Twilio, and stamps the result.
//
// Used by the browser-extension text endpoint (app/api/extension/text), which
// has no cookie session and so can't reuse the interactive route directly.
//
// ⚠ COMPLIANCE POLICY LIVES HERE AND IN app/api/txt/conversations/[id]/send
// (the direct-path branch). Keep the two in sync — signature suppression + the
// first-message "Reply STOP to opt out" notice must behave identically no matter
// which surface sent the text. A future cleanup should collapse the interactive
// route's direct path onto this helper; that refactor touches live customer
// texting so it deserves its own staging cycle (deferred from Session 1).
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSms, twilioConfigured, toE164 } from '@/lib/twilio'
import { renderTemplate } from '@/lib/txt-templates'
import { resolveFromNumber } from '@/lib/txt-numbers'
import { buildMessagePreview } from '@/lib/txt-preview'

type Admin = ReturnType<typeof createAdminClient>

export type DirectSendResult = {
  ok: boolean
  message_id?: string
  twilio_sid?: string
  status?: string
  error?: string
  code?: number
}

export async function sendDirectTxtMessage(opts: {
  admin: Admin
  companyId: string
  conversationId: string
  contact: { id: string; phone: string | null; name: string | null; do_not_text: boolean }
  userId: string
  body: string
  mediaUrls?: string[]
  templateId?: string | null
}): Promise<DirectSendResult> {
  const { admin, companyId, conversationId, contact, userId } = opts
  const mediaUrls = opts.mediaUrls ?? []
  const templateId = opts.templateId ?? null
  let text = (opts.body || '').trim()

  if (!text && mediaUrls.length === 0) return { ok: false, error: 'Empty message' }
  if (!contact.phone) return { ok: false, error: 'Contact has no phone' }
  if (contact.do_not_text) return { ok: false, error: 'Contact is marked do-not-text' }

  // ── Compose the final body (mirrors the interactive route's direct path) ────
  let finalText = text
  if (text) {
    const [{ data: sender }, { data: company }, { data: profile }, { data: txtSettings }] =
      await Promise.all([
        admin.from('hub_users').select('display_name').eq('id', userId).maybeSingle(),
        admin.from('companies').select('name').eq('id', companyId).maybeSingle(),
        admin.from('user_profiles').select('txt_signature').eq('id', userId).maybeSingle(),
        admin
          .from('txt_settings')
          .select('company_default_signature, allow_user_signatures, opt_out_message, opt_out_on_first_message')
          .eq('company_id', companyId)
          .maybeSingle(),
      ])

    const renderCtx = {
      contactName: contact.name || null,
      senderName: sender?.display_name || null,
      companyName: company?.name || null,
    }

    if (templateId) {
      text = renderTemplate(text, renderCtx)
      finalText = text
    }

    const settings = txtSettings as
      | {
          company_default_signature?: string | null
          allow_user_signatures?: boolean | null
          opt_out_message?: string | null
          opt_out_on_first_message?: boolean | null
        }
      | null
    const allowUserSig = settings?.allow_user_signatures !== false
    const personalSig = (profile?.txt_signature || '').trim()
    const companySig = (settings?.company_default_signature || '').trim()
    let signature = allowUserSig && personalSig ? personalSig : companySig

    if (signature) {
      // Don't repeat the signature back-to-back from the same sender.
      const { data: lastOut } = await admin
        .from('txt_messages')
        .select('sent_by')
        .eq('conversation_id', conversationId)
        .eq('direction', 'outbound')
        .neq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!lastOut || lastOut.sent_by !== userId) {
        signature = renderTemplate(signature, renderCtx)
        finalText = `${text}\n\n${signature}`
      }
    }

    // First outbound text to this contact → append the opt-out notice (CTIA).
    const optOutEnabled = settings?.opt_out_on_first_message !== false
    const optOutMsg = (settings?.opt_out_message ?? 'Reply STOP to opt out.').trim()
    if (optOutEnabled && optOutMsg) {
      const { data: priorOutbound } = await admin
        .from('txt_messages')
        .select('id')
        .eq('contact_id', contact.id)
        .eq('direction', 'outbound')
        .neq('status', 'failed')
        .limit(1)
        .maybeSingle()
      if (!priorOutbound) {
        const sep = finalText === text ? '\n\n' : '\n'
        finalText = `${finalText}${sep}${optOutMsg}`
      }
    }
  }

  // ── Insert the message row + bump the conversation ──────────────────────────
  const { data: inserted, error: insertErr } = await admin
    .from('txt_messages')
    .insert({
      company_id: companyId,
      conversation_id: conversationId,
      contact_id: contact.id,
      direction: 'outbound',
      body: finalText || null,
      media_urls: mediaUrls,
      sent_by: userId,
      status: 'sending',
    })
    .select('id')
    .single()
  if (insertErr || !inserted) {
    return { ok: false, error: insertErr?.message || 'Insert failed' }
  }

  await admin
    .from('txt_conversations')
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: buildMessagePreview(text, mediaUrls.length),
      last_message_direction: 'outbound',
    })
    .eq('id', conversationId)

  if (!twilioConfigured()) {
    await admin
      .from('txt_messages')
      .update({ status: 'failed', error_message: 'Twilio not configured (staging dev mode)' })
      .eq('id', inserted.id)
    return { ok: false, message_id: inserted.id, error: 'twilio_not_configured', status: 'failed' }
  }

  // ── Resolve From number + send ──────────────────────────────────────────────
  const fromNumber = await resolveFromNumber(admin, {
    conversationId,
    userId,
    companyId,
  })
  let fromNumberId: string | null = null
  if (fromNumber) {
    const { data: pn } = await admin
      .from('txt_phone_numbers')
      .select('id')
      .eq('company_id', companyId)
      .eq('twilio_number', fromNumber)
      .maybeSingle()
    fromNumberId = pn?.id ?? null
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
  const publicMediaUrls = mediaUrls.map((m) =>
    /^https?:\/\//i.test(m) ? m : `${baseUrl}/api/txt/media/${m}`
  )
  const statusCallback = `${baseUrl}/api/txt/twilio/sms/status`

  const result = await sendSms({
    to: contact.phone,
    body: finalText,
    mediaUrls: publicMediaUrls.length ? publicMediaUrls : undefined,
    statusCallback,
    fromNumber: fromNumber || undefined,
  })

  if (!result.ok) {
    await admin
      .from('txt_messages')
      .update({ status: 'failed', error_message: result.error, phone_number_id: fromNumberId })
      .eq('id', inserted.id)
    return { ok: false, message_id: inserted.id, error: result.error, code: result.code }
  }

  await admin
    .from('txt_messages')
    .update({ twilio_sid: result.sid, status: 'sent', phone_number_id: fromNumberId })
    .eq('id', inserted.id)

  return { ok: true, message_id: inserted.id, twilio_sid: result.sid, status: result.status }
}

// Find-or-create the contact + direct conversation for a raw phone number, then
// send through sendDirectTxtMessage. For non-interactive server surfaces that
// only have a phone (Daily Log On-My-Way + service-report texts) and can't reuse
// the interactive route. Mirrors the extension text endpoint's find-or-create so
// these texts behave like any other Txt: they land in the unified thread (owned
// by the sending user) and customer replies route back to the Txt inbox.
export async function sendDirectTxtToPhone(opts: {
  admin: Admin
  companyId: string
  userId: string
  phone: string
  name?: string | null
  body: string
  templateId?: string | null
}): Promise<DirectSendResult & { conversation_id?: string; contact_id?: string }> {
  const { admin, companyId, userId } = opts

  const e164 = toE164(opts.phone || '')
  if (!e164) return { ok: false, error: 'Invalid phone number' }

  // ── Find-or-create the contact (adopts an existing inbound stub by phone) ────
  type Contact = { id: string; phone: string | null; name: string | null; do_not_text: boolean }
  let contact: Contact | null = null

  const { data: existing } = await admin
    .from('txt_contacts')
    .select('id, phone, name, do_not_text')
    .eq('company_id', companyId)
    .eq('phone', e164)
    .maybeSingle()

  if (existing) {
    contact = existing as Contact
  } else {
    const name = (opts.name || '').trim() || e164
    const { data: created, error } = await admin
      .from('txt_contacts')
      .insert({
        company_id: companyId,
        phone: e164,
        phone_digits: e164.replace(/\D/g, '').slice(-10),
        name,
        do_not_text: false,
        in_directory: true,
        sources: ['daily-log'],
      })
      .select('id, phone, name, do_not_text')
      .single()
    if (error || !created) return { ok: false, error: error?.message || 'Contact create failed' }
    contact = created as Contact
  }

  // ── Find-or-create the direct conversation, owned by the sender ─────────────
  let conversationId: string
  const { data: existingConv } = await admin
    .from('txt_conversations')
    .select('id, status')
    .eq('company_id', companyId)
    .eq('contact_id', contact.id)
    .eq('kind', 'direct')
    .maybeSingle()

  if (existingConv) {
    conversationId = existingConv.id as string
    if (existingConv.status === 'archived') {
      // Reopen + take ownership (mirrors /conversations/start + extension text).
      await admin
        .from('txt_conversations')
        .update({ status: 'assigned', assigned_to: userId, archived_by: null })
        .eq('id', conversationId)
      await admin
        .from('txt_conversation_members')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('role', 'owner')
      await admin.from('txt_conversation_members').insert({
        conversation_id: conversationId,
        user_id: userId,
        role: 'owner',
        added_by: userId,
      })
    }
  } else {
    const { data: createdConv, error: convErr } = await admin
      .from('txt_conversations')
      .insert({
        company_id: companyId,
        contact_id: contact.id,
        assigned_to: userId,
        status: 'assigned',
        kind: 'direct',
      })
      .select('id')
      .single()
    if (convErr || !createdConv) return { ok: false, error: convErr?.message || 'Conversation create failed' }
    conversationId = createdConv.id as string
    await admin.from('txt_conversation_members').insert({
      conversation_id: conversationId,
      user_id: userId,
      role: 'owner',
      added_by: userId,
    })
  }

  const result = await sendDirectTxtMessage({
    admin,
    companyId,
    conversationId,
    contact,
    userId,
    body: opts.body,
    templateId: opts.templateId ?? null,
  })

  return { ...result, conversation_id: conversationId, contact_id: contact.id }
}
