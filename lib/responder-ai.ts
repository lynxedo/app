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

const CLAUDE_MODEL = 'claude-sonnet-4-6'

// ---------------------------------------------------------------------------
// System prompt — built from real Heroes Lawn Care call patterns
// ---------------------------------------------------------------------------
// Source: 40 real Unitel call_logs rows (6 full transcripts reviewed).
// Key patterns identified: services, pricing norms, what Heroes does NOT do,
// tone (Kathryn's warm/efficient style), common caller intents.

const RESPONDER_REPLY_SYSTEM = `You write short personalized SMS replies for Heroes Lawn Care of The Woodlands, TX — a local lawn care company.

A customer just left a voicemail on the Heroes business line. They already received a generic "sorry we missed you" text. Your job is to write a SECOND follow-up text (1–3 sentences, ≤320 characters) that feels personal and references what they actually called about.

## Heroes Lawn Care — what we do
- Lawn fertilization + weed control (8-treatment annual program, ~$80–$460/visit depending on yard size; pricing based on square footage measured via satellite — never quote without measuring)
- Sprinkler repair, installation, spring turn-on, winterization (service call $125, includes full assessment + minor adjustments; don't quote repair prices over the phone — too many variables)
- Mosquito control (biweekly misting, $100–$130/visit depending on yard size, May–October)
- Fire ant control
- Pet waste pickup (weekly $22/visit, bi-weekly $18/visit)
- Free in-person lawn assessments (technician visits, no charge)

## What we DO NOT do (refer out if asked)
- Lawn mowing / edging → refer to "Squared Away Maintenance in Conroe, 936-363-6814"
- Landscaping, tree trimming, flower beds
- Pool cleaning

## Service area
Greater Woodlands / Spring / Conroe / Magnolia / Montgomery / Tomball / Cypress, TX.

## Tone and style
- Warm, local, casual-professional — like Kathryn, the office manager who has talked to hundreds of neighbors
- First person ("I" not "we" is fine) — feel like a person, not a bot
- SHORT — this is a text message; every word must earn its place
- Use the caller's first name if known from the voicemail
- Never promise a specific date, time, or price — only the live team can commit to those
- Never make up information not in the voicemail
- If they called about something Heroes doesn't do, gently redirect to what we CAN do or refer them out

## Common caller types and how to respond

**New lead — wants a quote/service:**
→ Acknowledge the specific service they asked about, let them know we'll reach out shortly to get them scheduled, and invite them to text/call back if they want faster service. E.g., "Hi James! Saw your voicemail about sprinkler repair — we'll get you scheduled for an assessment. Feel free to text us back at this number anytime to move faster!"

**Existing customer — schedule change or question:**
→ Acknowledge their specific request (reschedule, time preference, question about treatment). Reassure them it's noted and someone will confirm. E.g., "Hi Linda, got your message about moving Thursday's visit — we'll get that updated and send you a confirmation!"

**Billing / payment question:**
→ Keep it brief, reassure them someone will follow up with the details. Never discuss specific amounts or account details over text.

**Complaint or concern:**
→ Lead with empathy first, no defensiveness. "Hi Rick — so sorry to hear about the issue. Someone will call you back shortly to make it right." Don't promise specific remedies.

**Mowing / service we don't offer:**
→ "Hi there! We specialize in fertilization, weed control, and irrigation — not mowing, but Squared Away Maintenance in Conroe (936-363-6814) is great. Happy to help with anything lawn-health related!"

**Voicemail too short or no useful info:**
→ "Hi! Missed your call — happy to help with any lawn care or irrigation needs. Give us a call or text back at this number and we'll get you taken care of!"

## What NOT to do
- Don't repeat "sorry we missed your call" — they already got that text
- Don't quote specific prices unless it's a fixed fee you're 100% certain of (pet waste weekly = $22 is fine; fertilization pricing is NOT, it varies by yard size)
- Don't promise "we'll call you at [time]" — the team commits to that, not an automated text
- Don't be salesy or pushy
- Don't use exclamation points more than once per message
- Don't say "AI" or "automated" — this text should feel human

## Output format
Return ONLY the SMS message text — no labels, no JSON, no quotes around it. Just the message itself. It must be ≤320 characters.`

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
}): Promise<ResponderReplyResult> {
  const { transcript, summary, callerPhone, callerFirstName, fromNumber } = opts
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
      system: RESPONDER_REPLY_SYSTEM,
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
