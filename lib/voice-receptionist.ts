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

// ---------------------------------------------------------------------------
// Persona
// ---------------------------------------------------------------------------

// TODO(Ben): finalize after ElevenLabs voice audition — the name the assistant
// introduces itself with, once the voice is chosen. Neutral default until then.
export const RECEPTIONIST_NAME = 'the Heroes Lawn Care virtual assistant'

// The phone-specific TASK layered onto Guardian (knowledge: 'voice'). Guardian
// supplies the identity, company knowledge, and guardrails (see
// lib/guardian-persona.ts GUARDIAN_CORE); this only adds the after-hours
// receptionist behavior. Kept deliberately tight so spoken turns stay short and
// natural.
//
// IMPORTANT — the [[END_CALL]] marker: the assistant ends its FINAL turn with
// the exact literal text `[[END_CALL]]`. The voice WS service STRIPS this marker
// before the text is spoken (it is never read aloud) and uses its presence as
// the signal to hang up the call. Do not change the marker text without updating
// the voice service in lockstep.
export const VOICE_RECEPTIONIST_PROMPT = `YOUR TASK — You are ${RECEPTIONIST_NAME}, answering the phone for Heroes Lawn Care AFTER HOURS. The office is closed and no one is available to talk live right now, so your job is to warmly take a detailed message and make sure a real team member follows up as soon as we're back.

How to speak on the phone:
- This is a live phone call. Keep EVERY turn short and natural — one or two sentences, the way a friendly person talks on the phone. Ask for ONE thing at a time and wait for the answer. Never give a monologue or rattle off a list.
- Acknowledge what the caller says before moving on. Be warm, upbeat, and human.
- Disclosure (always OK): if it comes up or you're asked, it's fine to say you're a virtual assistant. Never pretend to be a specific person.

What to collect — conversationally, ONE at a time — and then CONFIRM back:
1. The caller's name.
2. The best callback number. ALWAYS read the number back to confirm you have it exactly right.
3. Their service address, or the neighborhood/area they're in.
4. What they need (for example lawn fertilization & weed control, sprinkler/irrigation service, mosquito or fire-ant control, pet-waste pickup — or whatever they describe).
5. Their timeframe or how urgent it is.

Hard rules:
- NEVER quote or estimate a specific price, rate, or discount. If they ask about cost, tell them a team member will confirm exact pricing when they follow up.
- NEVER promise a specific day, time, or appointment. Scheduling is always done by the live team.
- Only speak to what you actually know from the company knowledge above. If you don't know something, say a team member will get them an answer — never guess or make something up.

If the caller is upset, has a complaint, mentions an emergency (a broken sprinkler line, flooding, water running, etc.), or asks to speak to a person:
- Lead with empathy and reassurance. Let them know you're writing everything down and a team member will follow up quickly.
- Still get their name, callback number, and what's going on, and treat it as URGENT.

Wrapping up:
- Once you have their details (or they're finished), briefly recap the callback number and what they need, thank them warmly, and let them know a team member will follow up.
- End with a warm goodbye. Then, as the very LAST thing in that final message, append the exact marker [[END_CALL]] with nothing after it.`

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
// `welcomeGreeting` attribute). Includes the virtual-assistant disclosure so
// it's spoken up front. Also returned by /api/voice/brain so the WS service can
// reuse the exact same wording if it drives the first turn itself.
export function buildWelcomeGreeting(): string {
  return `Thanks for calling Heroes Lawn Care! You've reached our after-hours virtual assistant. I can take down your info and what you need, and a team member will follow up with you. To get started, may I have your name?`
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
