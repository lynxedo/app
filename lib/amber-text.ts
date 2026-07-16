// Amber-over-text — the AI voice receptionist ("Amber") answering DRIP SMS
// replies inside the Txt thread (Track D). When a drip lead replies, the drip
// engine pauses the enrollment ('replied') and today a human takes over; this
// lets Amber qualify + book in the SAME text thread instead, reusing her brain,
// with a human able to seize the thread at any time (Amber then goes silent).
//
// Reuses the shared Guardian brain (lib/guardian-persona.buildGuardianSystem)
// over the thread's message history + Amber's tools (lib/amber-tools), exactly
// the way app/api/txt/conversations/[id]/suggest-reply runs the brain over a Txt
// thread and lib/hub-claude runs the agentic tool loop. NEW code only — it does
// not edit lib/voice-receptionist.ts, lib/drip.ts, or any app/api/voice/* route
// (some prompt text is reconstructed here for SMS; some tool logic is duplicated
// in lib/amber-tools — the integrator dedupes later).
//
// Everything is DARK by default: the per-line dial defaults off, autonomy
// defaults 'draft' (compose-only, no send), and AMBER_TEXT_TEST_MODE is treated
// as ON unless explicitly 'false' — so nothing is ever texted to a real person
// until an operator turns all of it on.
//
// Compliance rails: first-message AI disclosure ("virtual receptionist"), STOP
// always wins (do_not_text is re-checked right before every send), never invent
// quotes/dates (the tools own real dates), a human safety net (any human send /
// claim seizes the thread), and a max-turns auto-handoff.

import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildGuardianSystem } from '@/lib/guardian-persona'
import { getGuardianModel } from '@/lib/guardian-knowledge'
import { sendDirectTxtMessage } from '@/lib/txt-send'
import { lookupByPhone } from '@/lib/dialer-lookup'
import { getSchedulingEnabled } from '@/lib/voice-scheduling'
import {
  CUSTOMER_SERVICE_INSTRUCTION,
  SCHEDULING_INSTRUCTION,
  DEFAULT_RECEPTIONIST_NAME,
  clampReceptionistLevel,
} from '@/lib/voice-receptionist'
import { getAmberToolDefs, runAmberTool } from '@/lib/amber-tools'

type Admin = ReturnType<typeof createAdminClient>

// Staging/dark kill switch (mirrors DRIP_TEST_MODE / VOICE_TEST_MODE): treated as
// ON unless explicitly 'false'. When on, Amber composes + logs but never texts.
const AMBER_TEXT_TEST_MODE = process.env.AMBER_TEXT_TEST_MODE !== 'false'

// Grace between the lead's inbound reply and Amber's turn — lets them finish
// typing a multi-text thought and keeps Amber from racing the inbound pipeline.
const AMBER_TURN_GRACE_MS = 20_000
// Auto-handoff after this many Amber replies (a human takes it from there).
const AMBER_MAX_TURNS = 6

const MAX_HISTORY_MESSAGES = 16
const MAX_TOOL_ITERATIONS = 5
const MAX_TOKENS = 320 // SMS-length replies

const UUID_RE = /^[0-9a-f-]{36}$/i

// ─── Dial resolution ─────────────────────────────────────────────────────────
// The Amber-over-text dial is two switches ANDed together: the company master
// (voice_receptionist_settings.text_enabled) AND the per-line dial
// (txt_phone_numbers.amber_text_enabled). Level: per-line override →
// company text_level → the spoken-receptionist level → default 2. Autonomy:
// 'auto' sends, anything else ('draft', the default) composes-only.

type AmberDial = {
  on: boolean
  level: number // 1..5 (raw; behavior clamps separately)
  autonomy: string // 'auto' | 'draft'
  botUserId: string | null
  name: string
}

async function resolveAmberDial(admin: Admin, companyId: string, phoneNumberId: string | null): Promise<AmberDial> {
  const { data: vrs } = await admin
    .from('voice_receptionist_settings')
    .select('level, text_enabled, text_level, text_autonomy, text_bot_user_id, receptionist_name')
    .eq('company_id', companyId)
    .maybeSingle()
  const v = (vrs || {}) as {
    level?: number | null
    text_enabled?: boolean | null
    text_level?: number | null
    text_autonomy?: string | null
    text_bot_user_id?: string | null
    receptionist_name?: string | null
  }

  let lineEnabled = false
  let lineLevel: number | null = null
  if (phoneNumberId) {
    const { data: pn } = await admin
      .from('txt_phone_numbers')
      .select('amber_text_enabled, amber_text_level')
      .eq('id', phoneNumberId)
      .maybeSingle()
    const p = (pn || {}) as { amber_text_enabled?: boolean | null; amber_text_level?: number | null }
    lineEnabled = Boolean(p.amber_text_enabled)
    lineLevel = typeof p.amber_text_level === 'number' ? p.amber_text_level : null
  }

  const rawLevel =
    lineLevel ??
    (typeof v.text_level === 'number' ? v.text_level : null) ??
    (typeof v.level === 'number' ? v.level : null) ??
    2
  return {
    // Both the company master AND the specific line must be on. With no
    // phoneNumberId we can't confirm the line, so stay dark (fail-closed).
    on: Boolean(v.text_enabled) && lineEnabled,
    level: Math.max(1, Math.min(5, Math.round(rawLevel))),
    autonomy: (v.text_autonomy || '').trim() || 'draft',
    botUserId: v.text_bot_user_id ?? null,
    name: (v.receptionist_name || '').trim() || DEFAULT_RECEPTIONIST_NAME,
  }
}

// ─── Engagement gate ─────────────────────────────────────────────────────────

type EngageContact = { id?: string | null; phone?: string | null; do_not_text?: boolean | null }

type Engagement = { engage: boolean; dial: AmberDial; enrollmentId: string | null }

// The most recent PAUSED ('replied') drip enrollment for this contact/phone —
// the signal that this thread is an Amber-eligible drip lead who just engaged.
async function findRepliedEnrollmentId(admin: Admin, companyId: string, contact: EngageContact): Promise<string | null> {
  const contactId = contact.id && UUID_RE.test(contact.id) ? contact.id : null
  const digits = contact.phone ? contact.phone.replace(/\D/g, '').slice(-10) : null
  if (!contactId && !digits) return null

  let q = admin
    .from('drip_enrollments')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'replied')
    .order('enrolled_at', { ascending: false })
    .limit(1)
  // contactId is a validated uuid; digits is stripped to [0-9] — safe to inline.
  if (contactId && digits) q = q.or(`contact_id.eq.${contactId},phone_digits.eq.${digits}`)
  else if (contactId) q = q.eq('contact_id', contactId)
  else q = q.eq('phone_digits', digits as string)

  const { data } = await q.maybeSingle()
  return (data?.id as string) ?? null
}

async function evaluateAmberEngagement(
  admin: Admin,
  opts: { companyId: string; conversationId: string; phoneNumberId: string | null; contact: EngageContact },
): Promise<Engagement> {
  const dial = await resolveAmberDial(admin, opts.companyId, opts.phoneNumberId)
  // 1) The line dial must be on.
  if (!dial.on) return { engage: false, dial, enrollmentId: null }
  // 2) STOP / do-not-text always wins.
  if (opts.contact.do_not_text) return { engage: false, dial, enrollmentId: null }
  // 3) Not human-seized (or otherwise terminal). No row yet = eligible; an
  //    'active' row = still Amber's; anything else (human/handed_off/opted_out/
  //    completed) = Amber stays out.
  const { data: thread } = await admin
    .from('amber_text_threads')
    .select('status')
    .eq('conversation_id', opts.conversationId)
    .maybeSingle()
  if (thread && (thread.status as string) !== 'active') return { engage: false, dial, enrollmentId: null }
  // 4) The thread must be tied to a paused drip enrollment.
  const enrollmentId = await findRepliedEnrollmentId(admin, opts.companyId, opts.contact)
  if (!enrollmentId) return { engage: false, dial, enrollmentId: null }

  return { engage: true, dial, enrollmentId }
}

/**
 * Should Amber handle this Txt thread over text right now? True only when: the
 * line's dial is ON, the thread isn't human-seized, the contact isn't
 * opted-out/do_not_text, and the thread is tied to a paused ('replied') drip
 * enrollment. Public predicate (also used internally by maybeEnqueueAmberTurn).
 */
export async function amberShouldEngage(
  admin: Admin,
  opts: { companyId: string; conversationId: string; phoneNumberId: string | null; contact: EngageContact },
): Promise<boolean> {
  try {
    return (await evaluateAmberEngagement(admin, opts)).engage
  } catch (err) {
    console.warn('[amber-text] amberShouldEngage failed', err)
    return false
  }
}

/**
 * The entry the integrator calls from app/api/txt/twilio/sms/inbound AFTER
 * pauseEnrollmentsForInbound. If Amber should engage, upserts the
 * amber_text_threads row and schedules the turn for now + grace so the
 * /api/amber/text/process cron picks it up. No-op (never throws) when Amber
 * shouldn't engage. Idempotent on conversation_id (safe to call per inbound).
 */
export async function maybeEnqueueAmberTurn(
  admin: Admin,
  opts: {
    companyId: string
    conversationId: string
    contactId: string | null
    phone: string | null
    phoneNumberId: string | null
    enrollmentId?: string | null
  },
): Promise<void> {
  try {
    // Resolve the contact's opt-out flag (the caller only hands us the id/phone).
    let doNotText = false
    if (opts.contactId && UUID_RE.test(opts.contactId)) {
      const { data } = await admin.from('txt_contacts').select('do_not_text').eq('id', opts.contactId).maybeSingle()
      doNotText = Boolean((data as { do_not_text?: boolean } | null)?.do_not_text)
    }

    const contact: EngageContact = { id: opts.contactId, phone: opts.phone, do_not_text: doNotText }
    const evalRes = await evaluateAmberEngagement(admin, {
      companyId: opts.companyId,
      conversationId: opts.conversationId,
      phoneNumberId: opts.phoneNumberId,
      contact,
    })
    if (!evalRes.engage) return

    const enrollmentId = opts.enrollmentId ?? evalRes.enrollmentId
    // Upsert on conversation_id. turn_count / created_at are intentionally omitted
    // so a NEW row gets its default (0 / now) while an EXISTING active row keeps
    // its accumulated turn_count — we only (re)arm status + the due time.
    await admin.from('amber_text_threads').upsert(
      {
        company_id: opts.companyId,
        conversation_id: opts.conversationId,
        status: 'active',
        enrollment_id: enrollmentId,
        level: evalRes.dial.level,
        next_turn_at: new Date(Date.now() + AMBER_TURN_GRACE_MS).toISOString(),
      },
      { onConflict: 'conversation_id' },
    )
  } catch (err) {
    console.warn('[amber-text] maybeEnqueueAmberTurn failed', err)
  }
}

// ─── The turn runner ─────────────────────────────────────────────────────────

type ThreadRow = {
  id: string
  company_id: string
  status: string
  turn_count: number
  level: number | null
}

type MessageRow = { direction: 'inbound' | 'outbound'; body: string | null; media_urls: string[] | null; is_ai: boolean | null }

type ContactRow = { id: string; name: string | null; first_name: string | null; phone: string | null; do_not_text: boolean }

/**
 * Run one Amber turn for a Txt conversation: load history → assemble the shared
 * Guardian brain over an SMS task → run the tool loop → RE-CHECK for a human
 * seize / STOP just before sending → send as the Amber bot user (or, dark, log a
 * draft) and mark the message is_ai. Best-effort; never throws.
 */
export async function runAmberTextTurn(admin: Admin, opts: { conversationId: string }): Promise<void> {
  const { conversationId } = opts
  try {
    // Load the Amber thread; only proceed if Amber still owns it.
    const { data: threadData } = await admin
      .from('amber_text_threads')
      .select('id, company_id, status, turn_count, level')
      .eq('conversation_id', conversationId)
      .maybeSingle()
    const thread = threadData as ThreadRow | null
    if (!thread || thread.status !== 'active') return

    // Claim the turn: null next_turn_at so an overlapping cron tick won't
    // re-select this row while we generate. A human seize sets status='human'
    // (checked again right before send). Amber re-arms only on the next inbound.
    await admin.from('amber_text_threads').update({ next_turn_at: null }).eq('id', thread.id).eq('status', 'active')

    const companyId = thread.company_id

    // Conversation + contact.
    const { data: convRow } = await admin
      .from('txt_conversations')
      .select(
        `id, kind, contact_id,
         contact:txt_contacts!txt_conversations_contact_id_fkey ( id, name, first_name, phone, do_not_text )`,
      )
      .eq('id', conversationId)
      .maybeSingle()
    if (!convRow) return
    if ((convRow.kind as string) !== 'direct') {
      // Amber-over-text is 1:1 only. Hand a non-direct thread to a human.
      await handoff(admin, thread.id)
      return
    }
    const contact = (Array.isArray(convRow.contact) ? convRow.contact[0] : convRow.contact) as ContactRow | null
    if (!contact) return
    // STOP / do-not-text always wins.
    if (contact.do_not_text) {
      await admin
        .from('amber_text_threads')
        .update({ status: 'opted_out', next_turn_at: null })
        .eq('id', thread.id)
      return
    }

    // Resolve autonomy / name / bot user / level. There's no line id at turn
    // time, so dial.on is not meaningful here (the per-line dial was enforced at
    // enqueue); we re-check the COMPANY master separately so flipping the master
    // off mid-thread stops Amber quietly (no send).
    const dial = await resolveAmberDial(admin, companyId, null)
    if (!(await companyMasterEnabled(admin, companyId))) return

    const willSend = dial.autonomy === 'auto' && !AMBER_TEXT_TEST_MODE

    // Auto-handoff at the max-turn cap (before generating another reply).
    if (thread.turn_count >= AMBER_MAX_TURNS) {
      await handoff(admin, thread.id)
      return
    }
    // A real send needs a bot user to attribute the message to.
    if (willSend && !dial.botUserId) {
      console.warn('[amber-text] no text_bot_user_id configured — handing off', { conversationId })
      await handoff(admin, thread.id)
      return
    }

    // History → prompt.
    const { data: msgData } = await admin
      .from('txt_messages')
      .select('direction, body, media_urls, is_ai')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY_MESSAGES)
    const messages = ((msgData || []) as MessageRow[]).reverse() // chronological
    if (messages.length === 0) return
    const amberHasSpoken = messages.some((m) => m.direction === 'outbound' && m.is_ai)

    // Effective behavior level + scheduling capability.
    const level = thread.level ?? dial.level
    const baseLevel = clampReceptionistLevel(level) // 1..3 (base persona)
    const canSchedule = level >= 4 && (await getSchedulingEnabled(admin, companyId).catch(() => false))
    const name = dial.name

    // Model + system prompt (shared Guardian brain, customer knowledge + KB docs
    // scoped to the receptionist surface, same as the phone receptionist).
    const model = await getGuardianModel(admin, companyId).catch(() => CLAUDE_MODEL)
    const task = buildAmberTextTask({ name, baseLevel, canSchedule, firstAmberMessage: !amberHasSpoken })

    // Light account hint for a warm opener (the model can still call
    // account_lookup for the full picture). Best-effort, name only — never a balance.
    let jobberSummary: string | null = null
    try {
      const m = await lookupByPhone(contact.phone || '', companyId)
      if (m?.name && !m.nameIsCallerId) {
        jobberSummary = `${m.name} appears to be ${m.status === 'archived' ? 'a past customer' : m.status === 'customer' ? 'an existing customer' : 'a lead'}. Use account_lookup for their schedule; never state a balance.`
      }
    } catch {
      // non-fatal
    }

    const system = await buildGuardianSystem({
      companyId,
      knowledge: 'customer',
      surface: 'receptionist',
      task,
      jobberSummary,
      admin,
    })

    const historyText = formatHistory(messages, name)
    const who = contact.first_name?.trim() || contact.name?.trim() || 'the customer'
    const userMessage = `Here is the text conversation so far (oldest first):\n${historyText}\n\n---\nWrite the next text to send to ${who}. Reply to their most recent message.`

    const finalText = await generateAmberReply({
      model,
      system,
      userMessage,
      admin,
      companyId,
      phone: contact.phone,
      canSchedule,
    })
    if (!finalText) return

    // ── RE-CHECK the seize + STOP right before sending (minimizes the race
    //    window between generation and send). ──
    const { data: fresh } = await admin
      .from('amber_text_threads')
      .select('status')
      .eq('id', thread.id)
      .maybeSingle()
    if (!fresh || (fresh.status as string) !== 'active') return // a human seized mid-generation
    const { data: freshContact } = await admin
      .from('txt_contacts')
      .select('do_not_text')
      .eq('id', contact.id)
      .maybeSingle()
    if ((freshContact as { do_not_text?: boolean } | null)?.do_not_text) {
      await admin.from('amber_text_threads').update({ status: 'opted_out', next_turn_at: null }).eq('id', thread.id)
      return
    }

    const nowIso = new Date().toISOString()

    if (!willSend) {
      // Dark path: compose-only ('draft' autonomy) or AMBER_TEXT_TEST_MODE. Log
      // the draft (observable in staging) and advance the turn without texting.
      console.log('[amber-text] DRAFT (not sent)', {
        conversationId,
        autonomy: dial.autonomy,
        testMode: AMBER_TEXT_TEST_MODE,
        turn: thread.turn_count + 1,
        draft: finalText,
      })
      // Advance turn_count but DON'T touch next_turn_at: the start-of-turn claim
      // already nulled it, and if the lead fired another reply during generation
      // maybeEnqueueAmberTurn re-armed it — clobbering that here would drop the
      // follow-up turn.
      await admin
        .from('amber_text_threads')
        .update({ turn_count: thread.turn_count + 1, last_turn_at: nowIso })
        .eq('id', thread.id)
      return
    }

    // Live path: send as the Amber bot user, then flag the message is_ai.
    const res = await sendDirectTxtMessage({
      admin,
      companyId,
      conversationId,
      contact: { id: contact.id, phone: contact.phone, name: contact.name, do_not_text: contact.do_not_text },
      userId: dial.botUserId as string,
      body: finalText,
    })
    if (!res.ok) {
      console.warn('[amber-text] send failed — handing off', { conversationId, error: res.error })
      await handoff(admin, thread.id)
      return
    }
    if (res.message_id) {
      await admin.from('txt_messages').update({ is_ai: true }).eq('id', res.message_id)
    }
    // Advance turn_count but leave next_turn_at as-is (nulled by the claim, or
    // re-armed by a reply that arrived mid-generation) — see the draft path note.
    await admin
      .from('amber_text_threads')
      .update({ turn_count: thread.turn_count + 1, last_turn_at: nowIso })
      .eq('id', thread.id)
  } catch (err) {
    console.warn('[amber-text] runAmberTextTurn failed', conversationId, err)
  }
}

// Mark a thread handed off to a human (Amber done; a teammate takes over).
async function handoff(admin: Admin, threadId: string): Promise<void> {
  await admin.from('amber_text_threads').update({ status: 'handed_off', next_turn_at: null }).eq('id', threadId)
}

// Company master switch alone (used at turn time, when there's no line id).
async function companyMasterEnabled(admin: Admin, companyId: string): Promise<boolean> {
  const { data } = await admin
    .from('voice_receptionist_settings')
    .select('text_enabled')
    .eq('company_id', companyId)
    .maybeSingle()
  return Boolean((data as { text_enabled?: boolean } | null)?.text_enabled)
}

// ─── The seize hook (called by the Txt send + assign routes) ──────────────────

async function getAmberBotUserId(admin: Admin, companyId: string): Promise<string | null> {
  const { data } = await admin
    .from('voice_receptionist_settings')
    .select('text_bot_user_id')
    .eq('company_id', companyId)
    .maybeSingle()
  return (data as { text_bot_user_id?: string | null } | null)?.text_bot_user_id ?? null
}

/**
 * A real teammate touched this thread (sent a message or claimed/assigned it) →
 * seize it so Amber goes silent. No-op when Amber isn't actively driving the
 * thread, or when the actor IS the Amber bot user (Amber's own sends go through
 * sendDirectTxtMessage, not the interactive routes, but we guard anyway). Called
 * from app/api/txt/conversations/[id]/{send,assign}. Best-effort; never throws.
 */
export async function seizeAmberThreadForHuman(
  admin: Admin,
  opts: { conversationId: string; userId: string },
): Promise<void> {
  try {
    const { data: thread } = await admin
      .from('amber_text_threads')
      .select('id, company_id, status')
      .eq('conversation_id', opts.conversationId)
      .maybeSingle()
    if (!thread || (thread.status as string) !== 'active') return
    const botUserId = await getAmberBotUserId(admin, thread.company_id as string)
    if (botUserId && opts.userId === botUserId) return // the bot's own send — not a human
    await admin
      .from('amber_text_threads')
      .update({ status: 'human', next_turn_at: null })
      .eq('id', thread.id)
      .eq('status', 'active')
  } catch (err) {
    console.warn('[amber-text] seizeAmberThreadForHuman failed', opts.conversationId, err)
  }
}

// ─── Prompt assembly (SMS task layered onto the shared Guardian brain) ─────────

// Reconstructed SMS-appropriate versions of the voice task blocks that aren't
// exported from lib/voice-receptionist.ts (PROMPT_COLLECT, LEVEL_BEHAVIOR,
// PROMPT_ESCALATION); the exported CUSTOMER_SERVICE_INSTRUCTION +
// SCHEDULING_INSTRUCTION are imported and reused as-is (they already reference
// "your account-lookup / find_availability / book_appointment tool", which map
// to Amber's tools).

const PROMPT_TEXT_STYLE = `How to text:
- This is a live SMS conversation with someone who replied to a text from us. Keep EVERY reply short — one or two sentences, the way a real person texts. Ask for ONE thing at a time and wait for their answer. Never send a long paragraph, a list, or multiple questions at once.
- Plain text only: no markdown, asterisks, bullet points, emoji, links, or formatting. Write numbers and times the way a person would type them.
- Be warm, friendly, and human. Acknowledge what they said before moving on.`

const PROMPT_TEXT_COLLECT = `What to find out — one question per text, as it fits the flow (you already have their phone number, so never ask for it):
- Their name, if you don't have it yet.
- Their service address or the area they're in.
- What they need — any of the company's services from the knowledge above, or whatever they describe.
- Their timeframe or how soon they'd like it handled.`

const PROMPT_TEXT_RULES_COMMON = `- NEVER promise a specific day, time, price, or appointment unless a tool confirmed it. Scheduling and final pricing are confirmed by the live team.
- Only say what you actually know from the company knowledge above. If you don't know, say a team member will get them an answer — never guess or make something up.
- If they ask you to stop, or reply STOP, stop texting immediately and send nothing else.`

const LEVEL_BEHAVIOR_TEXT: Record<1 | 2 | 3, string> = {
  1: `Your style (Level 1 — message taker):
- Friendly but efficient: no small talk. Get right to taking their info.
- Do NOT answer questions about the company, its services, or pricing. Warmly deflect: "Great question — a team member will get you a full answer." Then keep collecting their details.

Hard rules:
- NEVER state, estimate, or discuss any price.
${PROMPT_TEXT_RULES_COMMON}`,

  2: `Your style (Level 2 — conversational):
- Warm and human. You MAY answer basic questions from the knowledge above: what services are offered, what isn't (with any refer-outs), the service area, and hours. Keep answers short.
- When it helps them decide, naturally share what makes the company a great choice (from the knowledge) — don't launch into a pitch.
- If the knowledge mentions any free or no-obligation offer (a free assessment, quote, or consultation), offer it as an easy next step.

Hard rules:
- NEVER state, estimate, or discuss any price — not even ranges or "starting at" figures. If they ask about cost, say a team member will go over exact pricing. (A free assessment is fine to mention — it's free, not a price.)
${PROMPT_TEXT_RULES_COMMON}`,

  3: `Your style (Level 3 — soft sell):
- Warm and human. You MAY answer basic questions from the knowledge above (services, what isn't offered with refer-outs, service area, hours) and naturally share what makes the company a great choice.
- Lead with any free or low-commitment offer the knowledge mentions — it's the easiest yes.
- Ask natural qualifying questions as the flow allows (what's going on, roughly the yard size, how soon they want it). Weave them in — don't interrogate.
- Work toward a soft commitment with an assumptive close when their interest feels warm: "Based on that, this would be a great fit — I can get you set up and a specialist will confirm the details. Sound good?" Never pressure.

Pricing rules (follow exactly):
- You may state a price ONLY for something the knowledge explicitly marks as a fixed, published fee. State it naturally.
- Anything the knowledge marks as variable (priced by size, requires measuring) must NEVER be quoted — not even a range. Say a team member will confirm exact pricing.
${PROMPT_TEXT_RULES_COMMON}`,
}

const PROMPT_TEXT_ESCALATION = `If they're upset, have a complaint, or mention an emergency or something urgent (a leak, flooding, a safety issue, property damage): lead with empathy, let them know you're noting it and a team member will follow up quickly, and treat it as urgent. Capture the details.`

const PROMPT_TEXT_HANDOFF = `Wrapping up and handing off:
- Once you've captured what they need (and answered what you can), let them know a team member will follow up to confirm the details.
- If they ask to talk to a person, want something you can't handle, or the conversation stalls, warmly let them know a real teammate will jump in — a person is monitoring this thread and can take over anytime.
- Keep any sign-off time-of-day neutral (you don't know when they're texting).`

function buildAmberTextTask(opts: {
  name: string
  baseLevel: 1 | 2 | 3
  canSchedule: boolean
  firstAmberMessage: boolean
}): string {
  const sections: string[] = [
    `YOUR TASK — You are ${opts.name}, a virtual receptionist helping over text for the company described above. Someone we reached out to has replied to our text; continue the conversation to help them, answer what you can, qualify them, and (when you can) get them booked — while a real teammate watches the thread and can step in anytime.`,
    PROMPT_TEXT_STYLE,
  ]

  if (opts.firstAmberMessage) {
    // Compliance: first-message AI disclosure.
    sections.push(
      `IMPORTANT — this is your FIRST reply in this thread. Before anything else, briefly and naturally let them know they're texting with ${opts.name}, the company's virtual receptionist (for example, "Hi, this is ${opts.name}, a virtual receptionist with us"). You must include this the first time. Never pretend to be a specific real person.`,
    )
  }

  sections.push(
    PROMPT_TEXT_COLLECT,
    LEVEL_BEHAVIOR_TEXT[opts.baseLevel],
    CUSTOMER_SERVICE_INSTRUCTION, // imported from lib/voice-receptionist (references account-lookup tool)
  )
  if (opts.canSchedule) {
    sections.push(SCHEDULING_INSTRUCTION) // imported (references find_availability / book_appointment)
  }
  sections.push(
    PROMPT_TEXT_ESCALATION,
    PROMPT_TEXT_HANDOFF,
    `Reply with ONLY the exact text to send — no quotes, no labels, no commentary. Send at most one text.`,
  )
  return sections.join('\n\n')
}

function formatHistory(rows: MessageRow[], amberName: string): string {
  return rows
    .map((m) => {
      const body = (m.body || '').trim()
      const hasMedia = Array.isArray(m.media_urls) && m.media_urls.length > 0
      const text = body || (hasMedia ? '(attachment)' : '')
      if (!text) return null
      if (m.direction === 'inbound') return `[Them] ${text}`
      return `[${m.is_ai ? amberName : 'Teammate'}] ${text}`
    })
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

// ─── The agentic tool loop (mirrors lib/hub-claude.askClaude, local tools) ─────

async function generateAmberReply(opts: {
  model: string
  system: Awaited<ReturnType<typeof buildGuardianSystem>>
  userMessage: string
  admin: Admin
  companyId: string
  phone: string | null
  canSchedule: boolean
}): Promise<string> {
  const anthropic = getAnthropic({ timeout: 60_000, maxRetries: 2 })
  const tools = getAmberToolDefs(opts.canSchedule)
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: opts.userMessage }]

  let finalText = ''
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: opts.model,
      max_tokens: MAX_TOKENS,
      system: opts.system,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
    })

    const hasToolUse = response.content.some((b) => b.type === 'tool_use')
    if (!hasToolUse || response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
      finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim()
      break
    }

    messages.push({ role: 'assistant', content: response.content })
    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (block) => ({
        type: 'tool_result' as const,
        tool_use_id: block.id,
        content: await runAmberTool(
          opts.admin,
          { companyId: opts.companyId, phone: opts.phone, canSchedule: opts.canSchedule },
          block.name,
          block.input,
        ),
      })),
    )
    messages.push({ role: 'user', content: toolResults })
  }

  // Strip any stray voice markers (Amber over text never hangs up / transfers).
  return finalText.replace(/\[\[(END_CALL|VOICEMAIL|TRANSFER)\]\]/g, '').trim()
}
