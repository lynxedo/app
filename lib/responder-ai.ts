// Responder AI — personalized SMS reply after voicemail transcription.
//
// After processVoicemail() runs and we have a transcript + summary, this
// module asks Claude to craft a short, personalized follow-up SMS that
// references what the caller actually said. The first SMS (the generic
// "sorry we missed you" template) already fired at call-time; this is the
// second, smarter message that arrives ~30–90s later once the transcript
// is ready.
//
// Called fire-and-forget from processVoicemail() when ai_reply_enabled is
// true on the responder_settings row.

import Anthropic from '@anthropic-ai/sdk'
import { sendSms } from '@/lib/twilio'
import { RESPONDER_REPLY_SYSTEM_DEFAULT } from '@/lib/responder-ai-prompt'
import { getAlwaysIncludedDocs } from '@/lib/guardian-knowledge'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildMessagePreview } from '@/lib/txt-preview'

const CLAUDE_MODEL = 'claude-sonnet-4-6'

// The system prompt (training doc) is admin-editable — stored on
// responder_settings.ai_reply_prompt and passed in via opts.systemPrompt.
// RESPONDER_REPLY_SYSTEM_DEFAULT (lib/responder-ai-prompt.ts) is the fallback
// when no custom prompt has been saved.
//
// Always-included Guardian knowledge-base docs (guardian_knowledge_docs rows
// with always_include=true) are appended to the system prompt automatically,
// exactly like Guardian's buildSystemPrompt() in lib/hub-claude.ts.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResponderReplyResult = {
  smsSent: boolean
  smsBody: string | null
  error: string | null
  latency_ms: number
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

// generateAndSendResponderReply — call after processVoicemail() succeeds.
//
// transcript: the full voicemail text from Deepgram
// summary: the Claude one-sentence summary from processVoicemail()
// callerPhone: E.164 phone number of the caller (the "from" on the inbound call)
// callerFirstName: first name from txt_contacts lookup, or null
// fromNumber: the Heroes Twilio number to send FROM
// companyId: for logging / do_not_text check
//
// Returns the result so the caller can log it to responder_calls.
export async function generateAndSendResponderReply(opts: {
  transcript: string
  summary: string | null
  callerPhone: string
  callerFirstName: string | null
  fromNumber: string
  companyId: string
  systemPrompt?: string | null
}): Promise<ResponderReplyResult> {
  const { transcript, summary, callerPhone, callerFirstName, fromNumber, companyId } = opts
  const basePrompt = opts.systemPrompt?.trim() || RESPONDER_REPLY_SYSTEM_DEFAULT
  const start = Date.now()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { smsSent: false, smsBody: null, error: 'ANTHROPIC_API_KEY not set', latency_ms: 0 }
  }

  if (!transcript.trim() && !summary) {
    return { smsSent: false, smsBody: null, error: 'no transcript or summary to work from', latency_ms: 0 }
  }

  // Append always-included Guardian knowledge-base docs (same protocol as
  // buildSystemPrompt() in lib/hub-claude.ts).
  let systemPrompt = basePrompt
  try {
    const admin = createAdminClient()
    const kbDocs = await getAlwaysIncludedDocs(admin, companyId)
    if (kbDocs.length > 0) {
      const kbSection = kbDocs
        .map(doc => `---\n\n## ${doc.title}\n\n${doc.body}`)
        .join('\n\n')
      systemPrompt = `${basePrompt}\n\n${kbSection}`
    }
  } catch {
    // KB load failure is non-fatal — proceed with the base prompt
  }

  try {
    // Build the user message — give Claude the transcript + any known context
    const nameLine = callerFirstName ? `Caller's first name: ${callerFirstName}` : 'Caller name: unknown'
    const userMessage = `${nameLine}

Voicemail summary: ${summary ?? '(none)'}

Full voicemail transcript:
${transcript.slice(0, 1500)}

Write the personalized SMS reply.`

    const anthropic = new Anthropic({ apiKey })
    const resp = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    const block = resp.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') {
      return { smsSent: false, smsBody: null, error: 'Claude returned no text', latency_ms: Date.now() - start }
    }

    const smsBody = block.text.trim().slice(0, 320)

    // Send via Twilio (fromNumber = optional override; falls back to TWILIO_PHONE_NUMBER)
    const smsResult = await sendSms({ to: callerPhone, fromNumber, body: smsBody })

    console.log(`[responder-ai] reply sent to ${callerPhone} (${Date.now() - start}ms): ${smsBody.slice(0, 80)}…`)

    // Log the AI reply into the Txt2 conversation so it appears in the Responder
    // tab. When ai_reply_enabled is ON the generic first-SMS (sendResponderText)
    // is SKIPPED by the reconciler — so this is the ONLY place the responder
    // conversation gets created and stamped. It must find-or-create the contact
    // and the direct conversation, mark it source='responder' (so it lands in
    // the Responder tab as Guardian-owned), and unarchive it so it surfaces.
    try {
      const admin2 = createAdminClient()

      // find-or-create the contact for this caller
      let contactId: string | null = null
      const { data: existingContact } = await admin2
        .from('txt_contacts')
        .select('id')
        .eq('company_id', companyId)
        .eq('phone', callerPhone)
        .maybeSingle()
      contactId = existingContact?.id ?? null
      if (!contactId) {
        const { data: created } = await admin2
          .from('txt_contacts')
          .insert({ company_id: companyId, phone: callerPhone, name: callerFirstName || callerPhone })
          .select('id')
          .single()
        contactId = created?.id ?? null
        if (!contactId) {
          // race / unique conflict — re-read
          const { data: again } = await admin2
            .from('txt_contacts')
            .select('id')
            .eq('company_id', companyId)
            .eq('phone', callerPhone)
            .maybeSingle()
          contactId = again?.id ?? null
        }
      }

      if (contactId) {
        // resolve our local phone-number row so replies route back correctly
        let phoneNumberId: string | null = null
        const { data: numberRow } = await admin2
          .from('txt_phone_numbers')
          .select('id')
          .eq('twilio_number', fromNumber)
          .maybeSingle()
        phoneNumberId = numberRow?.id ?? null

        // find-or-create the direct conversation; stamp Guardian ownership + unarchive
        const { data: existingConv } = await admin2
          .from('txt_conversations')
          .select('id, status, phone_number_id')
          .eq('company_id', companyId)
          .eq('contact_id', contactId)
          .eq('kind', 'direct')
          .maybeSingle()

        let conversationId: string | null = null
        if (existingConv) {
          conversationId = existingConv.id
          // Stamp source so it shows in the Responder tab. Unarchive if archived
          // so the Guardian reply resurfaces it. Leave assigned_to untouched — if
          // a human already claimed it, it stays theirs; otherwise it's Guardian-owned.
          const patch: Record<string, unknown> = { source: 'responder' }
          if (existingConv.status === 'archived') {
            patch.status = 'unassigned'
            patch.archived_by = null
          }
          if (phoneNumberId && !existingConv.phone_number_id) patch.phone_number_id = phoneNumberId
          await admin2.from('txt_conversations').update(patch).eq('id', conversationId)
        } else {
          const { data: createdConv } = await admin2
            .from('txt_conversations')
            .insert({
              company_id: companyId,
              contact_id: contactId,
              status: 'unassigned',
              kind: 'direct',
              phone_number_id: phoneNumberId,
              source: 'responder',
            })
            .select('id')
            .single()
          conversationId = createdConv?.id ?? null
        }

        if (conversationId) {
          const now = new Date().toISOString()
          await admin2.from('txt_messages').insert({
            company_id: companyId,
            conversation_id: conversationId,
            contact_id: contactId,
            direction: 'outbound',
            body: smsBody,
            media_urls: [],
            sent_by: null,
            status: smsResult.ok ? 'sent' : 'failed',
            twilio_sid: smsResult.ok ? (smsResult as { ok: true; sid: string }).sid : null,
          })
          await admin2
            .from('txt_conversations')
            .update({
              last_message_at: now,
              last_message_preview: buildMessagePreview(smsBody, 0),
              last_message_direction: 'outbound',
            })
            .eq('id', conversationId)
        }
      }
    } catch (logErr) {
      // Non-fatal — AI reply already sent; just log the failure
      console.warn('[responder-ai] failed to log AI reply to txt_messages', logErr)
    }

    return {
      smsSent: true,
      smsBody,
      error: null,
      latency_ms: Date.now() - start,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    console.warn('[responder-ai] failed', msg)
    return { smsSent: false, smsBody: null, error: msg, latency_ms: Date.now() - start }
  }
}
