// AI Voice Receptionist (Phase 1a) — website-side prompt + TwiML builders.
//
// A standalone WebSocket service (repo: ~/lynxedo-voice) runs the live phone
// call over Twilio ConversationRelay. That service is pure transport: it calls
// back into THIS app for all the brains —
//   • POST /api/voice/brain   → fetch the Guardian system prompt + model + greeting
//   • POST /api/voice/wrapup  → file the lead + notify the office after the call
//
// This module holds (a) the phone-specific task layered onto Guardian and (b)
// the TwiML the inbound webhook returns to hand a call to ConversationRelay.
// It is import-safe with no configured env (all builders are pure string ops).
//
// NOTE: The greetings + instructions below are DEFAULTS. The Admin → Dialer →
// AI Receptionist settings (voice_receptionist_settings) take precedence; the
// brain/twiml endpoints fall back to these when a field is blank.

// ---------------------------------------------------------------------------
// Capability levels
// ---------------------------------------------------------------------------
// The receptionist operates at one of four levels (Ben's product ladder —
// see Reference/PRDs/AI_RECEPTIONIST_PRD.md §13). Levels 1–3 are the same
// engine with different permissions; level 4 (live scheduling / Jobber writes
// mid-call) is NOT built yet and clamps to 3 at runtime.
//
//   1 — Message taker:   voicemail replacement. Collect + confirm, no Q&A.
//   2 — Conversational:  warm small talk + answers approved basics. No pricing.
//   3 — Soft sell:       + approved pricing, qualifying Qs, soft commitment.
//   4 — Full receptionist (coming soon): owns the call to close, books jobs.
//
// At SaaS time a subscription plan caps the level; effective level =
// min(admin-chosen, plan cap) — resolved in lib/voice-receptionist-settings.ts.
export type ReceptionistLevel = 1 | 2 | 3 | 4

/** Highest level with implemented behavior. Level 4 clamps to this. */
export const MAX_IMPLEMENTED_LEVEL: ReceptionistLevel = 3

export const RECEPTIONIST_LEVEL_LABELS: Record<ReceptionistLevel, { name: string; blurb: string }> = {
  1: { name: 'Message taker', blurb: 'A friendly voicemail replacement — collects the caller’s name, number, and reason, then promises a callback. Politely deflects all questions.' },
  2: { name: 'Conversational', blurb: 'Warm and human — brief small talk, answers approved basics (services, area, hours, refer-outs). Never states pricing. Ends in a callback.' },
  3: { name: 'Soft sell', blurb: 'Conversational plus: may state approved fixed pricing, asks qualifying questions, and works toward a soft commitment. A human still confirms and schedules.' },
  4: { name: 'Full receptionist', blurb: 'Owns the call start to close — real quotes and live scheduling into Jobber within your guardrails. Coming soon.' },
}

// Intentionally nameless for now (Ben's call) — the assistant refers to itself
// as "the virtual assistant." Swap here (or via Admin settings later) to name it.
export const RECEPTIONIST_NAME = 'the virtual assistant'

// ---------------------------------------------------------------------------
// Level-aware task prompt
// ---------------------------------------------------------------------------
// The phone-specific TASK layered onto Guardian (knowledge: 'voice'). Guardian
// supplies the company identity, knowledge, and universal guardrails; this only
// adds receptionist behavior for the chosen level. Kept deliberately tight so
// spoken turns stay short and natural.
//
// IMPORTANT — the [[END_CALL]] marker: the assistant ends its FINAL turn with
// the exact literal text `[[END_CALL]]`. The voice WS service STRIPS this marker
// before the text is spoken (it is never read aloud) and uses its presence as
// the signal to hang up the call. Do not change the marker text without updating
// the voice service in lockstep.

const PROMPT_INTRO = `YOUR TASK — You are ${RECEPTIONIST_NAME}, answering the company's phone when the team can't pick up live. This might be after hours, on a weekend, or because everyone is busy with other customers — don't assume which, and don't say "after hours." Your job is to warmly take a detailed message and make sure a real team member follows up as soon as possible. Who the company is, what services it offers (and doesn't), and its service area are all in the company knowledge above — speak only from that.`

const PROMPT_PHONE_STYLE = `How to speak on the phone:
- This is a live phone call. Keep EVERY turn short and natural — one or two sentences, the way a friendly person talks on the phone. Ask for ONE thing at a time and wait for the answer. Never give a monologue or rattle off a list.
- Everything you say is spoken aloud by text-to-speech: PLAIN conversational text only. Never use markdown, asterisks, bullet points, emoji, or any formatting. Write numbers the way a person would say them.
- Acknowledge what the caller says before moving on. Be warm, upbeat, and human.
- Disclosure (always OK): if it comes up or you're asked, it's fine to say you're a virtual assistant. Never pretend to be a specific person.`

const PROMPT_COLLECT = `What to collect — conversationally, ONE at a time — and then CONFIRM back:
1. The caller's name.
2. The best callback number. ALWAYS read the number back to confirm you have it exactly right.
3. Their service address, or the neighborhood/area they're in.
4. What they need (any of the company's services from the knowledge above — or whatever they describe).
5. Their timeframe or how urgent it is.`

const PROMPT_ESCALATION = `If the caller is upset, has a complaint, mentions an emergency (a broken sprinkler line, flooding, water running, etc.), or asks to speak to a person:
- Lead with empathy and reassurance. Let them know you're writing everything down and a team member will follow up quickly.
- Still get their name, callback number, and what's going on, and treat it as URGENT.`

const PROMPT_WRAPUP = `Wrapping up:
- Before you start to wrap up, warmly ask if there's anything else you can help them with — don't rush them off the call.
- Once you have their details (and they have nothing else), briefly recap the callback number and what they need, thank them warmly, and let them know a team member will follow up.
- Keep any sign-off time-of-day neutral — "thanks so much" or "have a great day," never "good morning/afternoon/evening" (you don't know when they're calling).
- End with a warm, unhurried goodbye. Then, as the very LAST thing in that final message, append the exact marker [[END_CALL]] with nothing after it.`

const PROMPT_RULES_COMMON = `- NEVER promise a specific day, time, or appointment. Scheduling is always done by the live team.
- Only speak to what you actually know from the company knowledge above. If you don't know something, say a team member will get them an answer — never guess or make something up.`

// Per-level behavior blocks.
const LEVEL_BEHAVIOR: Record<1 | 2 | 3, string> = {
  1: `Your conversational style (Level 1 — message taker):
- Be friendly but efficient: no small talk. Get right to taking the message.
- Do NOT answer questions about the company, its services, or pricing — not even basics. Warmly deflect every question: "Great question — a team member will get you a full answer when they call you back." Then continue collecting their info.

Hard rules:
- NEVER state, estimate, or discuss any price.
${PROMPT_RULES_COMMON}`,

  2: `Your conversational style (Level 2 — conversational):
- Be genuinely warm and human. If the caller opens with a greeting or small talk ("how are you?", the weather, "y'all staying busy?"), engage naturally — but keep it to one or two exchanges, then gently steer back to helping them.
- You MAY answer basic questions about the company from the knowledge above: what services are offered, what isn't offered (with the refer-out providers), the service area, and hours. Keep answers short and conversational.
- If they ask about anything the knowledge doesn't cover, a team member will get them an answer on the follow-up call.

Hard rules:
- NEVER state, estimate, or discuss any price — not even ranges or "starting at" figures. If they ask about cost, tell them a team member will confirm exact pricing when they follow up.
${PROMPT_RULES_COMMON}`,

  3: `Your conversational style (Level 3 — soft sell):
- Be genuinely warm and human. If the caller opens with a greeting or small talk, engage naturally — one or two exchanges, then gently steer back to helping them.
- You MAY answer basic questions about the company from the knowledge above: services, what isn't offered (with refer-outs), service area, and hours.
- Ask natural qualifying questions as the conversation allows: what's going on with their lawn/property, roughly how big the yard is, what they've tried before, and how soon they want it handled. Weave these in — don't interrogate.
- If their interest feels warm, ask for a soft commitment: "Want me to have the team get you set up? They'll confirm all the details with you." Whatever they answer, note it clearly — but never pressure.

Pricing rules (follow exactly):
- You may state a price ONLY if the company knowledge above explicitly marks it as a fixed, published fee that may be stated.
- Anything the knowledge marks as variable (priced by yard size, requires measuring, etc.) must NEVER be quoted — not even a range. Say a team member will confirm exact pricing.
- Never invent, estimate, or negotiate a price under any circumstances.

Hard rules:
${PROMPT_RULES_COMMON}`,
}

/** Clamp any stored/plan level to one with implemented behavior. */
export function clampReceptionistLevel(level: number | null | undefined): 1 | 2 | 3 {
  const n = typeof level === 'number' && Number.isFinite(level) ? Math.round(level) : 2
  return Math.max(1, Math.min(MAX_IMPLEMENTED_LEVEL, n)) as 1 | 2 | 3
}

/** Build the level-appropriate receptionist task prompt. */
export function buildVoiceReceptionistPrompt(level: number | null | undefined = 2): string {
  const lvl = clampReceptionistLevel(level)
  return [PROMPT_INTRO, PROMPT_PHONE_STYLE, PROMPT_COLLECT, LEVEL_BEHAVIOR[lvl], PROMPT_ESCALATION, PROMPT_WRAPUP].join('\n\n')
}

// Back-compat: the default (Level 2) prompt under the original export name.
// Used as the Admin-panel placeholder + anywhere a level isn't known.
export const VOICE_RECEPTIONIST_PROMPT = buildVoiceReceptionistPrompt(2)

// ---------------------------------------------------------------------------
// TwiML builders
// ---------------------------------------------------------------------------

// Local XML-attribute escaper. Mirrors the (unexported) helper in
// lib/twilio-voice.ts so this module has no server-only import surface.
function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// The greeting ConversationRelay speaks the instant the call connects (its
// `welcomeGreeting` attribute). Level-aware default: Level 1 gets straight to
// business; Levels 2+ open conversationally ("how are you doing today?") and
// let the conversation loop handle the caller's reply naturally. Neutral about
// time of day and why no one answered; includes the virtual-assistant
// disclosure so it's spoken up front.
export function buildWelcomeGreeting(level: number | null | undefined = 2): string {
  const lvl = clampReceptionistLevel(level)
  if (lvl === 1) {
    return `Thanks for calling Heroes Lawn Care! You've reached our virtual assistant — our team isn't able to take your call right now, but I can take down your details and someone will call you back. To start, may I have your name?`
  }
  return `Thanks for calling Heroes Lawn Care! This is our virtual assistant — how are you doing today?`
}

// Build the inbound-call TwiML that hands the caller to the ConversationRelay AI
// receptionist.
//
// `<Start><Recording>` MUST come before `<Connect>`: ConversationRelay silently
// ignores the REST API `record:true` flag, so a call-scoped recording started in
// TwiML is the only way to capture the audio. We point its status callback at the
// EXISTING dialer recording route so AI calls flow into the same R2 storage +
// transcription pipeline as every other call (the inbound webhook already
// inserted the matching `calls` row keyed on this CallSid, so it links up).
//
// (Note: Twilio's noun is `<Recording>`, NOT the `<Record>` verb — `<Record>`
// captures the caller only, voicemail-style. Verified via the Twilio
// call-recordings guidance.)
export function buildConversationRelayTwiml(opts: {
  baseUrl: string
  wssUrl: string
  wsKey: string
  voiceId: string
  greeting: string
}): string {
  const relayUrl = `${opts.wssUrl}?key=${encodeURIComponent(opts.wsKey)}`
  const recordingCallback = `${opts.baseUrl}/api/dialer/voice/recording`
  const fallbackAction = `${opts.baseUrl}/api/voice/twiml/fallback`
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Start>` +
    `<Recording recordingStatusCallback="${escapeXmlAttr(recordingCallback)}" recordingStatusCallbackEvent="completed"/>` +
    `</Start>` +
    `<Connect action="${escapeXmlAttr(fallbackAction)}">` +
    `<ConversationRelay url="${escapeXmlAttr(relayUrl)}" welcomeGreeting="${escapeXmlAttr(opts.greeting)}" ttsProvider="ElevenLabs" voice="${escapeXmlAttr(opts.voiceId)}" transcriptionProvider="Deepgram" interruptible="true"/>` +
    `</Connect>` +
    `</Response>`
  )
}
