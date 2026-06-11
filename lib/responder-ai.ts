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

const CLAUDE_MODEL = 'claude-sonnet-4-6'

// The system prompt (training doc) is admin-editable — stored on
// responder_settings.ai_reply_prompt and passed in via opts.systemPrompt.
// RESPONDER_REPLY_SYSTEM_DEFAULT (lib/responder-ai-prompt.ts) is the fallback
// when no custom prompt has been saved.

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
  const { transcript, summary, callerPhone, callerFirstName, fromNumber } = opts
  const systemPrompt = opts.systemPrompt?.trim() || RESPONDER_REPLY_SYSTEM_DEFAULT
  const start = Date.now()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { smsSent: false, smsBody: null, error: 'ANTHROPIC_API_KEY not set', latency_ms: 0 }
  }

  if (!transcript.trim() && !summary) {
    return { smsSent: false, smsBody: null, error: 'no transcript or summary to work from', latency_ms: 0 }
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
    await sendSms({ to: callerPhone, fromNumber, body: smsBody })

    console.log(`[responder-ai] reply sent to ${callerPhone} (${Date.now() - start}ms): ${smsBody.slice(0, 80)}…`)

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
