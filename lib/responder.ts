import type { SupabaseClient } from '@supabase/supabase-js'
import { sendSms } from '@/lib/twilio'
import { resolveFromNumber } from '@/lib/txt-numbers'
import { buildMessagePreview } from '@/lib/txt-preview'

export type ResponderMode = 'off' | 'forwarded_line' | 'main_line'

export type ResponderSettings = {
  id: string
  company_id: string
  mode: ResponderMode
  business_days: number[]       // 0=Sun, 1=Mon … 6=Sat
  business_hours_start: string  // 'HH:MM'
  business_hours_end: string    // 'HH:MM'
  // Templates vary on two axes: time-of-day (business vs after-hours) × whether
  // the caller left a voicemail. The unsuffixed fields are the "left a voicemail"
  // copies (kept from the original schema); *_no_message_template are sent when
  // the caller hung up without leaving a message.
  business_hours_template: string
  business_hours_no_message_template: string
  afterhours_template: string
  afterhours_no_message_template: string
  ai_reply_enabled: boolean
}

export type ResponderCall = {
  id: string
  call_sid: string | null
  from_number: string | null
  called_at: string
  has_voicemail: boolean
  text_sent: boolean
  email_sent: boolean
  template_used: string | null
  error_message: string | null
}

export const RESPONDER_DEFAULTS: Omit<ResponderSettings, 'id' | 'company_id'> = {
  mode: 'off',
  business_days: [1, 2, 3, 4, 5],
  business_hours_start: '08:00',
  business_hours_end: '17:00',
  business_hours_template:
    "Hi {first_name}, thanks for the message — this is Heroes Lawn Care. We're with another customer right now but will call you back shortly. Feel free to text us right here for a faster response!",
  business_hours_no_message_template:
    "Hi {first_name}! We saw you called Heroes Lawn Care but missed you. We're with another customer — text us back here and we'll help you right away!",
  afterhours_template:
    "Hi {first_name}, thanks for the message — this is Heroes Lawn Care. We're currently closed but will call you back first thing in the morning. You're welcome to text us here anytime!",
  afterhours_no_message_template:
    "Hi {first_name}! We saw you called Heroes Lawn Care. We're closed right now but text us back here and we'll reach out first thing in the morning!",
  ai_reply_enabled: false,
}

export function isInBusinessHours(settings: {
  business_days: number[]
  business_hours_start: string
  business_hours_end: string
}): boolean {
  const now = new Date()
  const tz = 'America/Chicago'

  const weekdayStr = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' })
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const dayNum = dayMap[weekdayStr] ?? -1

  const timeStr = now.toLocaleTimeString('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = timeStr.split(':')
  const currentMinutes = (parseInt(parts[0], 10) % 24) * 60 + parseInt(parts[1], 10)

  const [startH, startM] = settings.business_hours_start.split(':').map(Number)
  const [endH, endM] = settings.business_hours_end.split(':').map(Number)

  return (
    settings.business_days.includes(dayNum) &&
    currentMinutes >= startH * 60 + startM &&
    currentMinutes < endH * 60 + endM
  )
}

export function renderTemplate(template: string, vars: { first_name?: string | null }): string {
  return template.replace(/{first_name}/g, vars.first_name || 'there')
}

/**
 * Pick the correct template for a responder auto-text.
 * Axes: time-of-day (business vs after-hours) × voicemail left or not.
 */
export function pickResponderTemplate(
  templates: {
    business_hours_template: string
    business_hours_no_message_template: string
    afterhours_template: string
    afterhours_no_message_template: string
  },
  opts: { inBusinessHours: boolean; hadVoicemail: boolean }
): { body: string; label: string } {
  const { inBusinessHours, hadVoicemail } = opts
  if (inBusinessHours) {
    return hadVoicemail
      ? { body: templates.business_hours_template, label: 'business_hours' }
      : { body: templates.business_hours_no_message_template, label: 'business_hours_no_message' }
  }
  return hadVoicemail
    ? { body: templates.afterhours_template, label: 'afterhours' }
    : { body: templates.afterhours_no_message_template, label: 'afterhours_no_message' }
}

export type SendResponderTextResult = {
  textSent: boolean
  templateUsed: string | null
  error: string | null
}

/**
 * Send a responder auto-text to a caller, logging it through the Txt2 system so
 * it appears in the inbox and the customer's reply threads into the same
 * conversation. This is the single send point for the responder — it is where a
 * future Guardian AI step would read the voicemail transcript and craft a custom
 * reply (and later respond to inbound replies) instead of a static template.
 *
 * Find-or-creates the contact + direct conversation, inserts an outbound message,
 * resolves the correct from-number, and sends via Twilio.
 */
export async function sendResponderText(
  admin: SupabaseClient,
  opts: {
    companyId: string
    fromNumber: string
    ourNumber?: string | null
    inBusinessHours: boolean
    hadVoicemail: boolean
    templates: {
      business_hours_template: string
      business_hours_no_message_template: string
      afterhours_template: string
      afterhours_no_message_template: string
    }
  }
): Promise<SendResponderTextResult> {
  const { companyId, fromNumber, ourNumber } = opts

  if (!fromNumber) {
    return { textSent: false, templateUsed: null, error: 'no_from_number' }
  }

  // Find-or-create the contact for this phone. (txt_contacts stores a single
  // `name` column — there is no first_name — so derive the first name below.)
  const { data: existingContact } = await admin
    .from('txt_contacts')
    .select('id, name, do_not_text')
    .eq('company_id', companyId)
    .eq('phone', fromNumber)
    .maybeSingle()

  if (existingContact?.do_not_text) {
    return { textSent: false, templateUsed: null, error: 'do_not_text' }
  }

  let contactId = existingContact?.id ?? null
  // First name for the template; fall back to "there" (handled in renderTemplate)
  // when the name is missing or is just the phone-number placeholder.
  const rawName = existingContact?.name ?? null
  const firstName = rawName && rawName !== fromNumber ? rawName.trim().split(/\s+/)[0] : null
  if (!contactId) {
    const { data: created } = await admin
      .from('txt_contacts')
      .insert({ company_id: companyId, phone: fromNumber, name: fromNumber })
      .select('id')
      .single()
    contactId = created?.id ?? null
    if (!contactId) {
      // Insert may have lost a race or hit a unique constraint — re-read.
      const { data: again } = await admin
        .from('txt_contacts')
        .select('id')
        .eq('company_id', companyId)
        .eq('phone', fromNumber)
        .maybeSingle()
      contactId = again?.id ?? null
    }
  }
  if (!contactId) {
    return { textSent: false, templateUsed: null, error: 'contact_create_failed' }
  }

  // Resolve our local txt_phone_numbers row from the number the call came in on,
  // so the conversation is stamped with the right line and replies route back
  // through it.
  let phoneNumberId: string | null = null
  if (ourNumber) {
    const { data: numberRow } = await admin
      .from('txt_phone_numbers')
      .select('id')
      .eq('twilio_number', ourNumber)
      .maybeSingle()
    phoneNumberId = numberRow?.id ?? null
  }

  // Find-or-create the direct conversation; reopen if archived.
  const { data: existingConv } = await admin
    .from('txt_conversations')
    .select('id, status, phone_number_id')
    .eq('company_id', companyId)
    .eq('contact_id', contactId)
    .eq('kind', 'direct')
    .maybeSingle()

  let conversationId: string
  if (existingConv) {
    conversationId = existingConv.id
    const patch: Record<string, unknown> = {}
    if (existingConv.status === 'archived') {
      patch.status = 'unassigned'
      patch.archived_by = null
    }
    if (phoneNumberId && !existingConv.phone_number_id) patch.phone_number_id = phoneNumberId
    if (Object.keys(patch).length > 0) {
      await admin.from('txt_conversations').update(patch).eq('id', conversationId)
    }
  } else {
    const { data: createdConv } = await admin
      .from('txt_conversations')
      .insert({
        company_id: companyId,
        contact_id: contactId,
        status: 'unassigned',
        kind: 'direct',
        phone_number_id: phoneNumberId,
      })
      .select('id')
      .single()
    if (!createdConv) {
      return { textSent: false, templateUsed: null, error: 'conversation_create_failed' }
    }
    conversationId = createdConv.id
  }

  const picked = pickResponderTemplate(opts.templates, {
    inBusinessHours: opts.inBusinessHours,
    hadVoicemail: opts.hadVoicemail,
  })
  const body = renderTemplate(picked.body, { first_name: firstName })

  // Log the outbound message first (status 'sending'), then send.
  const { data: inserted } = await admin
    .from('txt_messages')
    .insert({
      company_id: companyId,
      conversation_id: conversationId,
      contact_id: contactId,
      direction: 'outbound',
      body,
      media_urls: [],
      sent_by: null,
      status: 'sending',
    })
    .select('id')
    .single()

  const fromResolved = await resolveFromNumber(admin, { conversationId, companyId })
  const smsResult = await sendSms({
    to: fromNumber,
    body,
    fromNumber: fromResolved || ourNumber || undefined,
  })

  const now = new Date().toISOString()
  if (inserted) {
    await admin
      .from('txt_messages')
      .update(
        smsResult.ok
          ? { status: 'sent', twilio_sid: smsResult.sid }
          : { status: 'failed', error_message: (smsResult as { ok: false; error: string }).error }
      )
      .eq('id', inserted.id)
  }

  await admin
    .from('txt_conversations')
    .update({
      last_message_at: now,
      last_message_preview: buildMessagePreview(body, 0),
      last_message_direction: 'outbound',
    })
    .eq('id', conversationId)

  return {
    textSent: smsResult.ok,
    templateUsed: picked.label,
    error: smsResult.ok ? null : (smsResult as { ok: false; error: string }).error,
  }
}
