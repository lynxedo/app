// AI Voice Receptionist — website-side prompt + TwiML builders.
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
// NOTE: The greetings + instructions below are DEFAULTS. The Admin → AI →
// Receptionist settings (voice_receptionist_settings) take precedence; the
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
//   2 — Conversational:  warm small talk, answers basics, talks the company up. No pricing.
//   3 — Soft sell:       + approved pricing, qualifying Qs, assumptive soft close.
//   4 — Full receptionist (coming soon): owns the call to close, books jobs.
//
// At SaaS time a subscription plan caps the level; effective level =
// min(admin-chosen, plan cap) — resolved in lib/voice-receptionist-settings.ts.
export type ReceptionistLevel = 1 | 2 | 3 | 4 | 5

/**
 * Highest level with a distinct BASE persona prompt. Levels 4 and 5 don't get a
 * new base persona — they reuse the Level-3 soft-sell base and LAYER extra
 * capability on top (the brain appends instructions + the voice service offers
 * extra tools):
 *   Level 4 = base(3) + scheduling (SCHEDULING_INSTRUCTION + booking tools)
 *   Level 5 = base(3) + scheduling + FRONTLINE (routing directory + route_call)
 * So the base prompt always clamps to this; 4 and 5 add layers.
 */
export const MAX_IMPLEMENTED_LEVEL: ReceptionistLevel = 3
// Highest level an admin may SELECT.
export const MAX_SELECTABLE_LEVEL: ReceptionistLevel = 5

export const RECEPTIONIST_LEVEL_LABELS: Record<ReceptionistLevel, { name: string; blurb: string }> = {
  1: { name: 'Message taker', blurb: 'A friendly voicemail replacement — collects the caller’s name, number, and reason, then promises a callback. Politely deflects all questions.' },
  2: { name: 'Conversational', blurb: 'Warm and human — brief small talk, answers approved basics, and talks the company up. Promotes any free/no-obligation offer. Never states pricing. Ends in a callback.' },
  3: { name: 'Soft sell', blurb: 'Conversational plus: states approved fixed pricing, asks qualifying questions, and works an assumptive soft close. A human specialist still confirms and schedules.' },
  4: { name: 'Full receptionist', blurb: 'Everything in Soft sell, plus live scheduling — checks availability and books appointments within your guardrails. Only answers missed / after-hours calls.' },
  5: { name: 'Frontline receptionist', blurb: 'Answers EVERY call as your front desk (replaces a phone menu): greets, figures out who they need, and routes them to the right person or department — and can still sell and book like Level 4.' },
}

// Default persona name — a neutral, SaaS-generic placeholder. Each company sets
// its own in Admin → AI → Receptionist (voice_receptionist_settings.receptionist_name);
// Heroes is seeded to "Amber".
export const DEFAULT_RECEPTIONIST_NAME = 'Alex'

/** Per-company / per-build knobs that shape the assembled prompt + greeting. */
export type ReceptionistPromptOpts = {
  /** Persona name spoken to callers. Defaults to DEFAULT_RECEPTIONIST_NAME. */
  name?: string | null
  /** Whether the assistant offers to text the caller a recap at the end. */
  recapEnabled?: boolean
}

function resolveName(name?: string | null): string {
  const n = (name || '').trim()
  return n || DEFAULT_RECEPTIONIST_NAME
}

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

function promptIntro(name: string): string {
  return `YOUR TASK — You are ${name}, answering the company's phone when the team can't pick up live. This might be after hours, on a weekend, or because everyone is busy with other customers — don't assume which, and don't say "after hours." Your job is to warmly help the caller, capture their details, and make sure a real team member follows up as soon as possible. Who the company is, what services it offers (and doesn't), and its service area are all in the company knowledge above — speak only from that.`
}

const PROMPT_PHONE_STYLE = `How to speak on the phone:
- This is a live phone call. Keep EVERY turn short and natural — one or two sentences, the way a friendly person talks on the phone. Ask for ONE thing at a time and wait for the answer. Never give a monologue or rattle off a list.
- Everything you say is spoken aloud by text-to-speech: PLAIN conversational text only. Never use markdown, asterisks, bullet points, emoji, or any formatting. Write numbers the way a person would say them.
- Acknowledge what the caller says before moving on. Be warm, upbeat, and human.
- Disclosure (always OK): if it comes up or you're asked, it's fine to say you're a virtual receptionist. Never pretend to be a specific real person.`

const PROMPT_COLLECT = `What to collect — conversationally, ONE at a time — and then CONFIRM back:
1. The caller's name.
2. The best callback number. ALWAYS read the number back to confirm you have it exactly right. (If a "THIS CALL" note below already gives the number they're calling from, confirm THAT number instead of asking them to recite it.)
3. Their service address, or the neighborhood/area they're in.
4. What they need (any of the company's services from the knowledge above — or whatever they describe).
5. Their timeframe or how urgent it is.`

// Shared "sell" building blocks (Levels 2 & 3). Content comes from the company
// knowledge — never hardcode company specifics here.
const SELL_COMPANY = `- When it helps the caller decide, naturally share what makes the company a great choice — the things in the company knowledge above (for example free assessments, strong reviews, or specialized expertise). Weave it into the conversation warmly; do NOT launch into a sales pitch or recite a list of features unprompted.`

const SELL_FREE_ASSESSMENT = `- If the company knowledge mentions any free or no-obligation offer (a free assessment, quote, or consultation), offer it as an easy, no-pressure next step and try to get them interested.`

// Always-on voicemail escape hatch. Appended to the task by /api/voice/brain so
// it applies whether a company uses the default instructions or custom ones, and
// at every level. The voice WS service turns the [[VOICEMAIL]] marker into a
// handoff that records a voicemail instead of continuing with the assistant.
export const VOICEMAIL_ESCAPE_INSTRUCTION = `Leaving a voicemail instead:
- If the caller would rather leave a voicemail, says they don't want to talk to an assistant, or asks for a specific person's voicemail — warmly agree. Say something brief like "Of course — let me get you to our voicemail now, one moment." Then, as the very last thing in that message, append the exact marker [[VOICEMAIL]] with nothing after it. Like [[END_CALL]], this marker is never spoken aloud — it sends the caller to the voicemail recording.`

// Customer-service handling (PRD §18). Appended by /api/voice/brain to EVERY
// call's task — like the voicemail escape hatch — so it applies at every level
// and even when a company uses fully custom instructions (it can't be edited
// away). Amber's job on a service call is to TRIAGE and CAPTURE, never to change
// anything herself: she may look up a caller's next scheduled visit and its
// service on request (via her account-lookup tool, which reads live from
// Jobber), but reschedules, billing, and complaints are taken down and routed to
// a human. Level-safe: sharing a caller's own
// appointment isn't a company/services/pricing question, so it doesn't conflict
// with the Level 1 "deflect questions" style.
export const CUSTOMER_SERVICE_INSTRUCTION = `Handling different kinds of calls:
- First, get a feel for WHY they're calling — a new customer or someone wanting a quote, an existing customer with a service or schedule question, a complaint, or a billing question. You don't have to ask outright; listen and adapt. When it's unclear, just be helpful and take good notes.
- Existing customer asking about their next visit, when the team is coming, or what service is scheduled: you can look this up. First tell them you're checking — a brief "sure, let me pull that up, one moment" — then use your account-lookup tool and share what it finds in plain, natural words (for example, "it looks like you're on the schedule for Thursday the seventeenth for a lawn treatment"). If the lookup finds nothing, let them know a team member will confirm — never guess a date or a service.
- Reschedule, cancel, skip, or add-a-service requests: you cannot change the schedule yourself. Warmly take down exactly what they want, read it back to confirm, and let them know a team member will take care of it and follow up — never say it's done or promise a specific change will happen.
- Billing or payment questions: do NOT read out balances, amounts owed, or specific charges, and never dispute a charge. Reassure them you'll pass it straight to the office team, and take a short message (what it's about, plus their callback number).
- A complaint or an upset caller: lead with genuine empathy, let them know you're writing everything down and a manager will be notified right away, and capture every detail. Treat it as urgent.`

// Level-4 scheduling playbook. Appended by /api/voice/brain ONLY when the
// company is at Level 4 AND scheduling is enabled (canSchedule) — so it never
// shows up (and the booking tools are never offered) below Level 4. Tells Amber
// how to use her find_availability / book_appointment tools; the tools + the
// availability/booking rules live on the website side.
export const SCHEDULING_INSTRUCTION = `Booking an appointment (you can schedule on this call):
- When a caller wants to book or schedule a service, first tell them you're checking — a brief "let me find the next opening for you, one moment" — then use your find_availability tool with the service they asked for.
- The tool gives you the first open day and arrival window. Offer exactly what it returns, in warm natural words (for example, "the soonest we could come out is Thursday the seventeenth, with a morning arrival between eight and noon — would that work?"). Never invent or guess a day or time; only offer what the tool gives you.
- If the caller agrees, use your book_appointment tool with the exact service, date, and window from the availability result. Then confirm warmly, let them know a specialist will lock in the exact timing, and that they'll get a confirmation.
- If the tool says the service is a recurring sign-up, don't pick a specific time — just confirm they'd like to get started and that a specialist will set up the first visit.
- If the tool says it's a new customer or that it can't book directly, collect their name and full address and let them know a specialist will call to confirm — do not promise a specific day or time.
- Only offer to book the services your tools handle. For anything else, take a message as usual, and never promise a final price on the call.`

// Level-5 FRONTLINE layer. Appended by /api/voice/brain ONLY when the company is
// at Level 5 (frontline) AND the call arrived on a frontline-eligible line — so
// it never changes behavior below Level 5. Reframes the persona from "answering
// when the team can't pick up" to "the primary front-desk receptionist on every
// call", and tells her how to route callers to the right person/department using
// her route_call tool. She keeps all the Level 3/4 abilities (answer, sell, book).
// The actual routing destinations come from the company's routing directory,
// injected right after this by buildRoutingDirectoryNote().
export const FRONTLINE_INSTRUCTION = `You are the primary front-desk receptionist:
- You answer EVERY call — you are not a fallback or a voicemail. Do not say the team "can't pick up," "isn't available," or that they're "busy with other customers." You ARE the front desk. Greet the caller, find out how you can help, and either help them yourself or get them to the right person.
- Your first job on any call is to figure out what they need: a new customer or someone wanting a quote (help them and sell, like usual), an existing customer with a question (help or take a message), or someone who needs a specific person or department (route them — see below).
- Routing to a person or department: the "WHO YOU CAN ROUTE TO" list below is who's reachable and what each handles. When a caller asks for someone by name, asks for a department (billing, service, sales, a specific person), or clearly needs someone you can't help directly, use your route_call tool with the best-matching entry from that list. First say a brief, warm line like "Sure, let me get you over to Kathryn — one moment," then use the tool. If the tool confirms the connection, end that message with the exact marker [[TRANSFER]] as the very last thing (never spoken aloud — it puts the caller through). If the tool says no one's available, don't promise a transfer: offer to take a message or send them to voicemail.
- Only route when the caller genuinely needs a specific person or something you can't handle. If you can help them yourself — answer a question, capture a lead, book a job — do that first. Routing is for when they need a human you can't substitute for.
- If nothing in the routing list fits what they need, help them yourself and take a detailed message for the team; don't force a transfer to the wrong place.`

// Renders the company's routing directory into the prompt so the assistant knows
// who exists and what each handles. Only reachable (enabled) entries are passed
// in; person destinations are pre-filtered for availability by the brain. Empty
// list → a short note that there's no one to route to right now (she then just
// helps + takes messages). Pure string builder.
export type RoutingDirectoryNoteEntry = { label: string; kind: string; description: string }
export function buildRoutingDirectoryNote(entries: RoutingDirectoryNoteEntry[]): string {
  if (!entries.length) {
    return `WHO YOU CAN ROUTE TO:\n- No one is set up to receive transfers right now. Help the caller yourself and take a detailed message for the team; do not offer to transfer or connect them to a person.`
  }
  const lines = entries.map((e) => {
    const what = (e.description || '').trim()
    return `- ${e.label}${what ? ` — ${what}` : ''}`
  })
  return `WHO YOU CAN ROUTE TO (use route_call with the matching name/label):\n${lines.join('\n')}`
}

// Transfer availability is per-call (depends on business hours + admin config),
// so the brain injects the right variant. When available, Amber can put the
// caller on hold while we try to reach a live person; when not, she takes a
// message. The [[TRANSFER]] marker is handled by the voice service + the CR
// <Connect action> fallback route (which runs the configured transfer method).
export function buildTransferInstruction(available: boolean): string {
  if (available) {
    return `Connecting to a live person:
- A team member may be reachable right now. If the caller asks to speak to a person, or clearly needs a live human (not just a callback), warmly say something like "Let me see if someone's available — one moment." Then, as the very last thing in that message, append the exact marker [[TRANSFER]] with nothing after it. It is never spoken aloud; it puts the caller on hold while we try to reach someone. Only use it when they genuinely want a live person now — otherwise keep helping and take a message as usual.`
  }
  return `Connecting to a live person:
- No team member is available to connect to right now. If the caller asks for a person, empathize and assure them a team member will follow up soon — offer to take a detailed message or send them to voicemail. Do NOT say you'll connect or transfer them right now, and never use a transfer marker.`
}

const PROMPT_ESCALATION = `If the caller is upset, has a complaint, mentions an emergency or something urgent (a leak, flooding, a safety issue, property damage, etc.), or asks to speak to a person:
- Lead with empathy and reassurance. Let them know you're writing everything down and a team member will follow up quickly.
- Still get their name, callback number, and what's going on, and treat it as URGENT.`

function promptWrapup(recapEnabled: boolean): string {
  const recapLine = recapEnabled
    ? `\n- Offer to text them a recap: say something like "So you've got our number saved, I'll shoot you a quick text with a recap of what we talked about — is that okay?" If they say yes, let them know it's on its way. If they'd rather not, that's completely fine — don't push.`
    : ''
  return `Wrapping up:
- Before you start to wrap up, warmly ask if there's anything else you can help them with — don't rush them off the call.
- Once you have their details (and they have nothing else), briefly recap the callback number and what they need, thank them warmly, and let them know a team member will follow up.${recapLine}
- Keep any sign-off time-of-day neutral — "thanks so much" or "have a great day," never "good morning/afternoon/evening" (you don't know when they're calling).
- End with a warm, unhurried goodbye. Then, as the very LAST thing in that final message, append the exact marker [[END_CALL]] with nothing after it.`
}

const PROMPT_RULES_COMMON = `- NEVER promise a specific day, time, or appointment. Scheduling is always done by the live team.
- Only speak to what you actually know from the company knowledge above. If you don't know something, say a team member will get them an answer — never guess or make something up.`

// Per-level behavior blocks (Level 4 clamps to 3).
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
${SELL_COMPANY}
${SELL_FREE_ASSESSMENT}
- If they ask about anything the knowledge doesn't cover, a team member will get them an answer on the follow-up call.

Hard rules:
- NEVER state, estimate, or discuss any price — not even ranges, "starting at" figures, or fixed fees. If they ask about cost, warmly tell them a team member will go over exact pricing when they follow up. (The free assessment is fine to mention — it's free, not a price.)
${PROMPT_RULES_COMMON}`,

  3: `Your conversational style (Level 3 — soft sell):
- Be genuinely warm and human. If the caller opens with a greeting or small talk, engage naturally — one or two exchanges, then gently steer back to helping them.
- You MAY answer basic questions about the company from the knowledge above: services, what isn't offered (with refer-outs), service area, and hours.
${SELL_COMPANY}
${SELL_FREE_ASSESSMENT}
- Ask natural qualifying questions as the conversation allows — what's going on with their lawn or property, roughly how big the yard is, what they've tried before, how soon they want it handled, and for pet waste: how many dogs, the dogs' size, and how often they'd want service. Weave these in — don't interrogate.
- Work toward a soft commitment. When their interest feels warm, use an assumptive close: "Based on what you've told me, that would be a great fit — I can get you set up to start, and our scheduling specialist will give you a quick call to lock in the day. Sound good?" If they agree, that's a real win — note it clearly and let them know a specialist will call to finalize. Never pressure; "let me think about it" is a fine answer.

Working toward the soft close:
- Lead with any free or low-commitment offer the company knowledge mentions (a free assessment, a free quote, an inspection) — it's the easiest yes.
- You may name a specific price ONLY for something the knowledge marks as a fixed, published fee; state it naturally and early, since a clear price helps a serious caller move forward.
- For anything the knowledge marks as variable (priced by size, requires measuring, etc.), don't quote it — a specialist confirms exact pricing.

Pricing rules (follow exactly):
- You may state a price ONLY if the company knowledge above explicitly marks it as a fixed, published fee that may be stated.
- Anything the knowledge marks as variable (priced by yard size, requires measuring, etc.) must NEVER be quoted — not even a range. Say a team member will confirm exact pricing.
- NEVER promise a final price or a specific start date — those are always confirmed by the scheduling specialist on the callback. Never invent, estimate, or negotiate a price.

Hard rules:
${PROMPT_RULES_COMMON}`,
}

/** Clamp any stored/plan level to one with implemented behavior. */
export function clampReceptionistLevel(level: number | null | undefined): 1 | 2 | 3 {
  const n = typeof level === 'number' && Number.isFinite(level) ? Math.round(level) : 2
  return Math.max(1, Math.min(MAX_IMPLEMENTED_LEVEL, n)) as 1 | 2 | 3
}

/** Build the level-appropriate receptionist task prompt. */
export function buildVoiceReceptionistPrompt(
  level: number | null | undefined = 2,
  opts: ReceptionistPromptOpts = {},
): string {
  const lvl = clampReceptionistLevel(level)
  const name = resolveName(opts.name)
  const recapEnabled = opts.recapEnabled !== false // default on
  return [
    promptIntro(name),
    PROMPT_PHONE_STYLE,
    PROMPT_COLLECT,
    LEVEL_BEHAVIOR[lvl],
    PROMPT_ESCALATION,
    promptWrapup(recapEnabled),
  ].join('\n\n')
}

// Back-compat: the default (Level 2) prompt under the original export name.
// Used as the Admin-panel placeholder + anywhere a level isn't known.
export const VOICE_RECEPTIONIST_PROMPT = buildVoiceReceptionistPrompt(2)

// ---------------------------------------------------------------------------
// Job-title → spoken service decoding
// ---------------------------------------------------------------------------
// A service-naming rule maps a bit of text found on a customer's scheduled work
// to a plain phrase the receptionist says out loud. `match` is generic and
// convention-free: it can be a whole service name ("Pet Waste Removal Weekly"),
// a word ("Irrigation"), or a short code a business happens to use ("IR").
// Nothing about any one company's naming is assumed. Editable per company in
// Admin → AI → Receptionist (voice_receptionist_settings.title_service_map).
// Order matters — the first matching rule wins. The list below is a starter
// default a business tunes to its own Jobber services.
export type TitleServiceRule = { match: string; say: string }

export const DEFAULT_TITLE_SERVICE_MAP: TitleServiceRule[] = [
  { match: 'WF', say: 'lawn treatment' },
  { match: 'IR', say: 'sprinkler service call' },
  { match: 'PW', say: 'pet waste pickup' },
  { match: 'MO', say: 'mosquito treatment' },
]

// Does `text` (a line-item name, or a visit title) match a rule's `match`?
// Generic and convention-free: case-insensitive, anchored on segment boundaries
// (start/end or any non-alphanumeric char) with an optional trailing digit run.
// So "IR" hits "IR - Irrigation" and "IR2" but NOT "Repair" or "Irrigation", and
// a multi-word match like "Pet Waste" matches "PW - Pet Waste Removal Weekly".
export function serviceRuleMatches(text: string | null | undefined, match: string): boolean {
  const src = (text || '').toUpperCase()
  const m = (match || '').trim().toUpperCase()
  if (!src || !m) return false
  const esc = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Z0-9])${esc}[0-9]*([^A-Z0-9]|$)`).test(src)
}

// First rule (in order) whose match hits `text` → its spoken phrase, else null.
function sayForText(text: string | null | undefined, rules: TitleServiceRule[]): string | null {
  for (const rule of rules) {
    const code = (rule.match || '').trim()
    const say = (rule.say || '').trim()
    if (code && say && serviceRuleMatches(text, code)) return say
  }
  return null
}

// A line item off a Jobber visit/job — its name and total price.
export type ServiceLineItem = { name?: string | null; totalPrice?: number | null }

// Decode the spoken service from a visit's LINE ITEMS using the company's rules.
// Line items are the real services on the job (universal to every Jobber account),
// unlike the freeform visit title. Picks the HIGHEST-PRICED line item that matches
// a rule — the "main service" — so add-ons, discounts, and fees are ignored on
// their own. Returns the phrase + the line item it came from, or null when nothing
// matches (the caller then hears just the date, never an invented service).
export function decodeServiceFromLineItems(
  items: ServiceLineItem[] | null | undefined,
  rules: TitleServiceRule[] = DEFAULT_TITLE_SERVICE_MAP,
): { say: string; lineItem: string } | null {
  let best: { say: string; lineItem: string; price: number } | null = null
  for (const it of items || []) {
    const say = sayForText(it?.name, rules)
    if (!say) continue
    const price = typeof it?.totalPrice === 'number' ? it.totalPrice : 0
    if (!best || price > best.price) best = { say, lineItem: (it?.name || '').trim(), price }
  }
  return best ? { say: best.say, lineItem: best.lineItem } : null
}

// Spoken service phrase for a Jobber visit TITLE. Kept as a backstop for the
// line-item decode above — used only when a visit somehow carries no line items.
// Same matcher, run against the single title string.
export function decodeServiceFromTitle(
  title: string | null | undefined,
  rules: TitleServiceRule[] = DEFAULT_TITLE_SERVICE_MAP,
): string | null {
  return sayForText(title, rules)
}

// ---------------------------------------------------------------------------
// Per-call context note
// ---------------------------------------------------------------------------
// Appended to the task by /api/voice/brain with what we know about THIS caller:
// their name (if they match an existing contact) and the number they're calling
// from (so the assistant confirms it instead of asking). Pure string builder.
export function buildCallContextNote(opts: {
  callerName?: string | null
  /** Human-readable phone (e.g. "(832) 555-1234") — already formatted for speech. */
  callerPhone?: string | null
  /** True when callerName came from OUR data (an existing contact), not carrier caller-ID. */
  callerIsExisting?: boolean
}): string {
  const lines: string[] = []
  const name = (opts.callerName || '').trim()
  if (name && opts.callerIsExisting) {
    lines.push(
      `- This number matches an existing contact named ${name}. Greet them warmly and, early on, confirm you're speaking with ${name} — don't just assume, since a family member could be on the same line.`,
    )
  }
  const phone = (opts.callerPhone || '').trim()
  if (phone) {
    lines.push(
      `- They are calling from ${phone}. Treat this as their likely callback number: confirm it by reading it back (for example "I've got you at ${phone} — is that the best number to reach you?") rather than asking them to recite their number. If they give a different number, use that instead.`,
    )
  }
  return lines.length ? `THIS CALL:\n${lines.join('\n')}` : ''
}

// ---------------------------------------------------------------------------
// Greetings
// ---------------------------------------------------------------------------

export type GreetingContext = 'business_hours' | 'after_hours'

export type GreetingOpts = {
  context?: GreetingContext
  name?: string | null
}

// The greeting ConversationRelay speaks the instant the call connects (its
// `welcomeGreeting` attribute). Two dimensions:
//   • level  — Level 1 gets straight to business; Levels 2+ open conversationally.
//   • context — business_hours ("our team is helping other customers") vs
//     after_hours ("our team isn't available right now"). Never claim the team
//     is unavailable during business hours.
// Both are DEFAULTS; a company overrides either greeting in Admin → AI →
// Receptionist. Neither offers voicemail/transfer yet — those greeting lines
// land in Phase 2 alongside the voicemail escape hatch + screened transfer.
export function buildWelcomeGreeting(
  level: number | null | undefined = 2,
  opts: GreetingOpts = {},
): string {
  const rawLevel = typeof level === 'number' && Number.isFinite(level) ? Math.round(level) : 2
  const name = resolveName(opts.name)

  // Level 5 (frontline) answers EVERY call as the front desk, so its greeting
  // must NOT imply the team is unavailable — she's the one who's supposed to
  // answer. A single greeting covers both business/after hours.
  if (rawLevel >= 5) {
    return `Thanks for calling! This is ${name}. How can I help you today?`
  }

  const lvl = clampReceptionistLevel(level)
  const context: GreetingContext = opts.context || 'after_hours'
  const availability =
    context === 'business_hours'
      ? 'Our team is helping other customers right now'
      : "Our team isn't available right now"

  if (lvl === 1) {
    return `Thanks for calling! You've reached ${name}, our virtual receptionist. ${availability}, but I can take your details and have someone call you back. To start, may I have your name?`
  }
  return `Thanks for calling! This is ${name}, our virtual receptionist. ${availability}, but I'd be happy to help you. If you'd rather leave a voicemail, just let me know — otherwise, how can I help today?`
}

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

// Build the inbound-call TwiML that hands the caller to the ConversationRelay AI
// receptionist.
//
// NOTE on recording (2026-07-10, corrected): an earlier version of this builder
// embedded `<Start><Recording>` here, on the (docs-plausible but WRONG)
// assumption that it was the only way to capture audio on a ConversationRelay
// call. Verified live it does NOT work — Twilio creates zero Recording
// resources for these calls and raises no error, so it silently no-ops
// (the same class of documented incompatibility as `<Connect><Stream>` +
// ConversationRelay). The recording is instead started via the REST API
// (`startCallRecording`, the same proven mechanism the real inbound/outbound
// dialer routes use) from app/api/voice/brain/route.ts once the call is
// confirmed connected — see that file for the full explanation.
export function buildConversationRelayTwiml(opts: {
  baseUrl: string
  wssUrl: string
  wsKey: string
  voiceId: string
  greeting: string
}): string {
  const relayUrl = `${opts.wssUrl}?key=${encodeURIComponent(opts.wsKey)}`
  const fallbackAction = `${opts.baseUrl}/api/voice/twiml/fallback`
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Connect action="${escapeXmlAttr(fallbackAction)}">` +
    `<ConversationRelay url="${escapeXmlAttr(relayUrl)}" welcomeGreeting="${escapeXmlAttr(opts.greeting)}" ttsProvider="ElevenLabs" voice="${escapeXmlAttr(opts.voiceId)}" transcriptionProvider="Deepgram" interruptible="true"/>` +
    `</Connect>` +
    `</Response>`
  )
}
