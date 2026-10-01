// Amber-over-text — the AI receptionist ("Amber") answering inbound texts in the
// Txt thread, with the same rules she uses on the phone.
//
// Built July 2026 for drip-campaign replies only, and never switched on. Widened
// Oct 1 2026 (Ben: "expand Amber to replying to texts... a separate setting...
// same rules as calls... if she hits a roadblock she alerts a human... her
// conversations remain unassigned and a human can claim them at any time"):
//   • She engages on ANY one-on-one thread nobody owns (status 'unassigned'), on
//     every line, when the company's "Reply to texts" switch is on. A thread a
//     teammate has claimed is theirs; she stays out.
//   • Optional head start: in business hours, wait N minutes for a teammate to
//     claim first; outside them, reply after a short typing grace.
//   • Same brain as the phone: today's date, the customer-service rules, the
//     booking protocol, the Right Now notes, and the SAME tool endpoints.
//   • Roadblock → hand_to_human: she marks the thread handed off, the office gets
//     an Office Alerts post, she sends one sign-off text and goes quiet. The
//     thread stays unassigned with a "Needs a human" badge until someone claims it.
//   • Claiming or replying seizes the thread (status 'human') — instantly, because
//     the turn re-checks ownership right before it sends. Archiving + a later
//     reopen resets her (resetAmberThreadOnReopen) so a new conversation starts fresh.
//
// Compliance rails kept from v1: first-message AI disclosure, STOP always wins
// (do_not_text re-checked right before every send), never invent quotes/dates (the
// tools own real dates), a max-turn handoff, and AMBER_TEXT_TEST_MODE treated as ON
// unless explicitly 'false' so nothing is texted until an operator says so.

import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildGuardianSystem } from '@/lib/guardian-persona'
import { getGuardianModel } from '@/lib/guardian-knowledge'
import { sendDirectTxtMessage } from '@/lib/txt-send'
import { lookupByPhone } from '@/lib/dialer-lookup'
import { buildTodayLine, getSchedulingEnabled } from '@/lib/voice-scheduling'
import { buildNotesBlock, getActiveVoiceNotes } from '@/lib/voice-notes'
import { isWithinBusinessHours, type BusinessHoursSchedule } from '@/lib/twilio-voice'
import {
  CUSTOMER_SERVICE_INSTRUCTION,
  TEXT_SCHEDULING_INSTRUCTION,
  DEFAULT_RECEPTIONIST_NAME,
  clampReceptionistLevel,
} from '@/lib/voice-receptionist'
import { getAmberToolDefs, runAmberTool, handThreadToHuman, type AmberToolContext } from '@/lib/amber-tools'

type Admin = ReturnType<typeof createAdminClient>

// Dark kill switch (mirrors DRIP_TEST_MODE / VOICE_TEST_MODE): treated as ON unless
// explicitly 'false'. When on, Amber composes + logs but never texts.
const AMBER_TEXT_TEST_MODE = process.env.AMBER_TEXT_TEST_MODE !== 'false'

// Grace between an inbound text and Amber's turn — lets them finish a multi-text
// thought and keeps Amber from racing the inbound pipeline.
const AMBER_TURN_GRACE_MS = 20_000
// Hand off after this many Amber replies in one thread.
const AMBER_MAX_TURNS = 8

const MAX_HISTORY_MESSAGES = 20
const MAX_TOOL_ITERATIONS = 6
const MAX_TOKENS = 320 // SMS-length replies

const UUID_RE = /^[0-9a-f-]{36}$/i

export type AmberThreadStatus = 'active' | 'human' | 'handed_off' | 'opted_out' | 'completed'

// ─── Settings ─────────────────────────────────────────────────────────────────
// One switch an admin sees (voice_receptionist_settings.text_enabled, "Reply to
// texts") plus the head-start option. Level: text_level → the spoken level →
// 2. Autonomy: 'auto' sends; 'draft' composes only (a dark mode set in the DB).

type AmberDial = {
  on: boolean
  level: number // 1..5 (raw; behavior clamps separately)
  autonomy: string // 'auto' | 'draft'
  botUserId: string | null
  name: string
  headStartEnabled: boolean
  headStartMinutes: number
}

// Every early exit says why — a silent skip is indistinguishable from a bug.
function skip(conversationId: string, reason: string): void {
  console.log('[amber-text] skip', { conversationId, reason })
}

async function resolveAmberDial(admin: Admin, companyId: string): Promise<AmberDial> {
  const { data: vrs, error: vrsErr } = await admin
    .from('voice_receptionist_settings')
    .select('level, text_enabled, text_level, text_autonomy, text_bot_user_id, receptionist_name, text_head_start_enabled, text_head_start_minutes')
    .eq('company_id', companyId)
    .maybeSingle()
  if (vrsErr) console.warn('[amber-text] settings read failed', vrsErr.message)
  const v = (vrs || {}) as {
    level?: number | null
    text_enabled?: boolean | null
    text_level?: number | null
    text_autonomy?: string | null
    text_bot_user_id?: string | null
    receptionist_name?: string | null
    text_head_start_enabled?: boolean | null
    text_head_start_minutes?: number | null
  }
  const rawLevel = (typeof v.text_level === 'number' ? v.text_level : null) ?? (typeof v.level === 'number' ? v.level : null) ?? 2
  return {
    on: Boolean(v.text_enabled),
    level: Math.max(1, Math.min(5, Math.round(rawLevel))),
    autonomy: (v.text_autonomy || '').trim() || 'draft',
    botUserId: v.text_bot_user_id ?? null,
    name: (v.receptionist_name || '').trim() || DEFAULT_RECEPTIONIST_NAME,
    headStartEnabled: Boolean(v.text_head_start_enabled),
    headStartMinutes: Math.max(1, Math.min(120, Math.round(Number(v.text_head_start_minutes) || 3))),
  }
}

async function inBusinessHours(admin: Admin, companyId: string): Promise<boolean> {
  try {
    const { data: ds } = await admin.from('dialer_settings').select('business_hours').eq('company_id', companyId).maybeSingle()
    return isWithinBusinessHours(((ds as { business_hours?: BusinessHoursSchedule | null } | null)?.business_hours ?? null))
  } catch {
    return false
  }
}

// ─── Engagement gate ─────────────────────────────────────────────────────────

type ConvRow = { id: string; kind: string | null; status: string | null; assigned_to: string | null; contact_id: string | null }

type Engagement = { engage: boolean; dial: AmberDial; reason: string }

async function evaluateAmberEngagement(
  admin: Admin,
  opts: { companyId: string; conversationId: string; contactId: string | null; phone: string | null },
): Promise<Engagement> {
  const dial = await resolveAmberDial(admin, opts.companyId)
  if (!dial.on) return { engage: false, dial, reason: 'switch_off' }

  // The thread must be a one-on-one that nobody owns. A claimed thread is the
  // owner's; a group thread is never hers.
  const { data: convData } = await admin
    .from('txt_conversations')
    .select('id, kind, status, assigned_to, contact_id')
    .eq('id', opts.conversationId)
    .maybeSingle()
  const conv = convData as ConvRow | null
  if (!conv) return { engage: false, dial, reason: 'no_conversation' }
  if ((conv.kind || 'direct') !== 'direct') return { engage: false, dial, reason: 'group' }
  if (conv.status !== 'unassigned' || conv.assigned_to) return { engage: false, dial, reason: 'claimed' }

  // STOP / do-not-text always wins.
  if (opts.contactId && UUID_RE.test(opts.contactId)) {
    const { data } = await admin.from('txt_contacts').select('do_not_text').eq('id', opts.contactId).maybeSingle()
    if ((data as { do_not_text?: boolean } | null)?.do_not_text) return { engage: false, dial, reason: 'do_not_text' }
  }

  // Never answer the company's own numbers (a test from the other line, a relay).
  if (opts.phone) {
    const { data: own } = await admin.from('txt_phone_numbers').select('id').eq('company_id', opts.companyId).eq('twilio_number', opts.phone).limit(1)
    if (own && own.length) return { engage: false, dial, reason: 'internal_number' }
  }

  // Her own thread record: none yet or 'active' = hers; a human seized it, she
  // handed it off, or they opted out = she stays out until the thread is archived
  // and reopened (see resetAmberThreadOnReopen).
  const { data: thread } = await admin.from('amber_text_threads').select('status').eq('conversation_id', opts.conversationId).maybeSingle()
  if (thread && (thread.status as string) !== 'active') return { engage: false, dial, reason: `thread_${thread.status as string}` }

  return { engage: true, dial, reason: 'ok' }
}

/**
 * Should Amber handle this Txt thread over text right now? Public predicate.
 */
export async function amberShouldEngage(
  admin: Admin,
  opts: { companyId: string; conversationId: string; contactId: string | null; phone: string | null },
): Promise<boolean> {
  try {
    return (await evaluateAmberEngagement(admin, opts)).engage
  } catch (err) {
    console.warn('[amber-text] amberShouldEngage failed', err)
    return false
  }
}

/**
 * Called from app/api/txt/twilio/sms/inbound for EVERY inbound text (not STOP).
 * If Amber should engage, upserts her thread row and schedules the turn — after a
 * short grace, or after the head start when the office is open and that option is
 * on — for the /api/amber/text/process cron. No-op (never throws) otherwise.
 * Idempotent on conversation_id (a second text re-arms the same turn).
 */
export async function maybeEnqueueAmberTurn(
  admin: Admin,
  opts: { companyId: string; conversationId: string; contactId: string | null; phone: string | null; enrollmentId?: string | null },
): Promise<void> {
  try {
    const evalRes = await evaluateAmberEngagement(admin, opts)
    if (!evalRes.engage) return

    let delayMs = AMBER_TURN_GRACE_MS
    if (evalRes.dial.headStartEnabled && (await inBusinessHours(admin, opts.companyId))) {
      delayMs = evalRes.dial.headStartMinutes * 60_000
    }
    // turn_count / created_at are omitted so a NEW row gets its defaults while an
    // EXISTING active row keeps its count — we only (re)arm status + the due time.
    await admin.from('amber_text_threads').upsert(
      {
        company_id: opts.companyId,
        conversation_id: opts.conversationId,
        status: 'active',
        ...(opts.enrollmentId ? { enrollment_id: opts.enrollmentId } : {}),
        level: evalRes.dial.level,
        next_turn_at: new Date(Date.now() + delayMs).toISOString(),
      },
      { onConflict: 'conversation_id' },
    )
  } catch (err) {
    console.warn('[amber-text] maybeEnqueueAmberTurn failed', err)
  }
}

/**
 * A thread archived and now reopened by a fresh inbound is a NEW conversation:
 * drop Amber's old record (human-seized, handed off, done) so she can engage again.
 * Called by the inbound webhook on the archived → unassigned transition only.
 */
export async function resetAmberThreadOnReopen(admin: Admin, conversationId: string): Promise<void> {
  try {
    await admin.from('amber_text_threads').delete().eq('conversation_id', conversationId).neq('status', 'opted_out')
  } catch (err) {
    console.warn('[amber-text] resetAmberThreadOnReopen failed', conversationId, err)
  }
}

/** Amber's status per conversation, for the Queue badges. */
export async function amberStatusByConversation(admin: Admin, conversationIds: string[]): Promise<Map<string, AmberThreadStatus>> {
  const out = new Map<string, AmberThreadStatus>()
  const ids = conversationIds.filter((id) => UUID_RE.test(id))
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from('amber_text_threads').select('conversation_id, status').in('conversation_id', ids.slice(i, i + 200))
    for (const r of (data as { conversation_id: string; status: string }[] | null) ?? []) {
      out.set(r.conversation_id, r.status as AmberThreadStatus)
    }
  }
  return out
}

// ─── The turn runner ─────────────────────────────────────────────────────────

type ThreadRow = { id: string; company_id: string; status: string; turn_count: number; level: number | null }

type MessageRow = { direction: 'inbound' | 'outbound'; body: string | null; media_urls: string[] | null; is_ai: boolean | null }

type ContactRow = { id: string; name: string | null; first_name: string | null; phone: string | null; do_not_text: boolean }

async function conversationStillHers(admin: Admin, conversationId: string): Promise<boolean> {
  const { data } = await admin.from('txt_conversations').select('status, assigned_to').eq('id', conversationId).maybeSingle()
  const c = data as { status?: string | null; assigned_to?: string | null } | null
  return Boolean(c && c.status === 'unassigned' && !c.assigned_to)
}

/**
 * Run one Amber turn for a Txt conversation: load history → assemble the shared
 * brain over an SMS task → run the tool loop → RE-CHECK ownership + STOP right
 * before sending → send as the Amber bot user (or, dark, log a draft).
 * Best-effort; never throws.
 */
export async function runAmberTextTurn(admin: Admin, opts: { conversationId: string }): Promise<void> {
  const { conversationId } = opts
  try {
    const { data: threadData } = await admin
      .from('amber_text_threads')
      .select('id, company_id, status, turn_count, level')
      .eq('conversation_id', conversationId)
      .maybeSingle()
    const thread = threadData as ThreadRow | null
    if (!thread || thread.status !== 'active') return skip(conversationId, `thread_${thread?.status ?? 'missing'}`)

    // Claim the turn: null next_turn_at so an overlapping cron tick won't re-select
    // this row while we generate. A human seize sets status='human' (checked again
    // right before send). Amber re-arms only on the next inbound.
    await admin.from('amber_text_threads').update({ next_turn_at: null }).eq('id', thread.id).eq('status', 'active')

    const companyId = thread.company_id
    const dial = await resolveAmberDial(admin, companyId)
    if (!dial.on) return skip(conversationId, 'switch_off')

    // Ownership check #1 — a teammate may have claimed it during the grace.
    if (!(await conversationStillHers(admin, conversationId))) {
      await admin.from('amber_text_threads').update({ status: 'human', next_turn_at: null }).eq('id', thread.id).eq('status', 'active')
      return skip(conversationId, 'claimed_before_turn')
    }

    const { data: convRow, error: convErr } = await admin
      .from('txt_conversations')
      .select(
        `id, kind, contact_id,
         contact:txt_contacts!txt_conversations_contact_id_fkey ( id, name, first_name, phone, do_not_text )`,
      )
      .eq('id', conversationId)
      .maybeSingle()
    if (!convRow) return skip(conversationId, `conversation_not_loaded${convErr ? `: ${convErr.message}` : ''}`)
    const contact = (Array.isArray(convRow.contact) ? convRow.contact[0] : convRow.contact) as ContactRow | null
    if (!contact) return skip(conversationId, 'no_contact')
    if (contact.do_not_text) {
      await admin.from('amber_text_threads').update({ status: 'opted_out', next_turn_at: null }).eq('id', thread.id)
      return
    }

    const willSend = dial.autonomy === 'auto' && !AMBER_TEXT_TEST_MODE
    if (willSend && !dial.botUserId) {
      console.warn('[amber-text] no text_bot_user_id configured — leaving the thread to a human', { conversationId })
      await admin.from('amber_text_threads').update({ status: 'handed_off', handoff_reason: 'other', handoff_summary: 'No bot user configured for Amber texts.', handed_off_at: new Date().toISOString(), next_turn_at: null }).eq('id', thread.id)
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
    if (messages.length === 0) return skip(conversationId, 'no_messages')
    const last = messages[messages.length - 1]
    if (!last || last.direction !== 'inbound') return skip(conversationId, 'last_message_not_inbound')
    const amberHasSpoken = messages.some((m) => m.direction === 'outbound' && m.is_ai)
    const lastInbound = (last.body || '').trim() || null

    const toolCtx: AmberToolContext = {
      companyId,
      conversationId,
      threadId: thread.id,
      phone: contact.phone,
      contactName: contact.name?.trim() || null,
      canSchedule: false,
      lastInbound,
      handedOff: null,
    }

    // Reply limit → hand off (with the alert) before generating another reply.
    if (thread.turn_count >= AMBER_MAX_TURNS) {
      await handThreadToHuman(admin, toolCtx, 'max_turns', `Amber has sent ${thread.turn_count} replies in this thread; a person should take it from here.`)
      return
    }

    const level = thread.level ?? dial.level
    const baseLevel = clampReceptionistLevel(level) // 1..3 (base persona)
    const canSchedule = level >= 4 && (await getSchedulingEnabled(admin, companyId).catch(() => false))
    toolCtx.canSchedule = canSchedule
    const name = dial.name

    const model = await getGuardianModel(admin, companyId).catch(() => CLAUDE_MODEL)
    const notes = await getActiveVoiceNotes(admin, companyId).catch(() => [])

    // Account hint for a warm opener (the model still calls account_lookup for the
    // schedule). Name only — never a balance.
    let jobberSummary: string | null = null
    let knownName: string | null = null
    try {
      const m = await lookupByPhone(contact.phone || '', companyId)
      if (m?.name && !m.nameIsCallerId) {
        knownName = m.name
        jobberSummary = `${m.name} appears to be ${m.status === 'archived' ? 'a past customer' : m.status === 'customer' ? 'an existing customer' : 'a lead'}. Use account_lookup for their schedule; never state a balance.`
      }
    } catch {
      // non-fatal
    }

    const task = buildAmberTextTask({
      name,
      baseLevel,
      canSchedule,
      firstAmberMessage: !amberHasSpoken,
      knownName,
      notesBlock: buildNotesBlock(notes),
    })
    const system = await buildGuardianSystem({ companyId, knowledge: 'customer', surface: 'receptionist', task, jobberSummary, admin })

    const historyText = formatHistory(messages, name)
    const who = contact.first_name?.trim() || contact.name?.trim() || knownName || 'the customer'
    const userMessage = `Here is the text conversation so far (oldest first):\n${historyText}\n\n---\nWrite the next text to send to ${who}. Reply to their most recent message.`

    const finalText = await generateAmberReply({ model, system, userMessage, admin, toolCtx })
    const handedOffThisTurn = Boolean(toolCtx.handedOff)
    if (!finalText) return skip(conversationId, 'empty_reply')

    // ── RE-CHECK ownership + STOP right before sending ──
    const { data: fresh } = await admin.from('amber_text_threads').select('status').eq('id', thread.id).maybeSingle()
    const freshStatus = (fresh?.status as string | undefined) ?? ''
    const mayStillSend = freshStatus === 'active' || (freshStatus === 'handed_off' && handedOffThisTurn)
    if (!mayStillSend) return skip(conversationId, `seized_${freshStatus}`)
    if (!(await conversationStillHers(admin, conversationId))) {
      await admin.from('amber_text_threads').update({ status: 'human', next_turn_at: null }).eq('id', thread.id).in('status', ['active', 'handed_off'])
      return
    }
    const { data: freshContact } = await admin.from('txt_contacts').select('do_not_text').eq('id', contact.id).maybeSingle()
    if ((freshContact as { do_not_text?: boolean } | null)?.do_not_text) {
      await admin.from('amber_text_threads').update({ status: 'opted_out', next_turn_at: null }).eq('id', thread.id)
      return
    }

    const nowIso = new Date().toISOString()
    if (!willSend) {
      // Dark path: compose-only ('draft') or AMBER_TEXT_TEST_MODE — log, don't text.
      console.log('[amber-text] DRAFT (not sent)', {
        conversationId,
        autonomy: dial.autonomy,
        testMode: AMBER_TEXT_TEST_MODE,
        turn: thread.turn_count + 1,
        handedOff: handedOffThisTurn,
        draft: finalText,
      })
      await admin.from('amber_text_threads').update({ turn_count: thread.turn_count + 1, last_turn_at: nowIso }).eq('id', thread.id)
      return
    }

    // Live path: send as the Amber bot user, flag the message is_ai, and keep the
    // thread UNASSIGNED (sendDirectTxtMessage only stamps the preview/direction on an
    // existing thread; a human claims it by replying or with Claim).
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
      if (!handedOffThisTurn) await handThreadToHuman(admin, toolCtx, 'other', `Amber's reply failed to send (${res.error || 'unknown error'}).`)
      return
    }
    if (res.message_id) await admin.from('txt_messages').update({ is_ai: true }).eq('id', res.message_id)
    await admin.from('amber_text_threads').update({ turn_count: thread.turn_count + 1, last_turn_at: nowIso }).eq('id', thread.id)
  } catch (err) {
    console.warn('[amber-text] runAmberTextTurn failed', conversationId, err)
  }
}

// ─── The seize hook (called by the Txt send + assign routes) ──────────────────

async function getAmberBotUserId(admin: Admin, companyId: string): Promise<string | null> {
  const { data } = await admin.from('voice_receptionist_settings').select('text_bot_user_id').eq('company_id', companyId).maybeSingle()
  return (data as { text_bot_user_id?: string | null } | null)?.text_bot_user_id ?? null
}

/**
 * A real teammate touched this thread (sent a message or claimed/assigned it) →
 * seize it so Amber goes silent and the "Needs a human" badge clears. No-op when
 * Amber isn't on the thread, or when the actor IS the Amber bot user. Called from
 * app/api/txt/conversations/[id]/{send,assign}. Best-effort; never throws.
 */
export async function seizeAmberThreadForHuman(admin: Admin, opts: { conversationId: string; userId: string }): Promise<void> {
  try {
    const { data: thread } = await admin.from('amber_text_threads').select('id, company_id, status').eq('conversation_id', opts.conversationId).maybeSingle()
    if (!thread) return
    const status = thread.status as string
    if (status !== 'active' && status !== 'handed_off') return
    const botUserId = await getAmberBotUserId(admin, thread.company_id as string)
    if (botUserId && opts.userId === botUserId) return // the bot's own send — not a human
    await admin.from('amber_text_threads').update({ status: 'human', next_turn_at: null }).eq('id', thread.id).in('status', ['active', 'handed_off'])
  } catch (err) {
    console.warn('[amber-text] seizeAmberThreadForHuman failed', opts.conversationId, err)
  }
}

// ─── Prompt assembly (SMS task layered onto the shared brain) ─────────────────

const PROMPT_TEXT_STYLE = `How to text:
- This is a live SMS conversation. Keep EVERY reply short — one or two sentences, the way a real person texts. Ask for ONE thing at a time and wait for their answer. Never send a long paragraph, a list, or several questions at once.
- Plain text only: no markdown, asterisks, bullet points, emoji, links, or formatting. Write numbers, dates, and times the way a person would type them.
- Be warm, friendly, and human. Acknowledge what they said before moving on. Don't repeat an empathetic line more than once.
- Don't say "hey there" or re-greet someone mid-conversation, and don't repeat the company name back to them.`

const PROMPT_TEXT_COLLECT = `What to find out — one question per text, as it fits the flow (you already have their phone number, so never ask for it):
- Their name, if you don't have it yet.
- Their service address or the area they're in.
- What they need — any of the company's services from the knowledge above, or whatever they describe.
- Their timeframe or how soon they'd like it handled.`

const PROMPT_TEXT_RULES_COMMON = `- NEVER promise a specific day, time, price, or appointment unless a tool confirmed it.
- Only say what you actually know from the company knowledge above. If you don't know, hand the thread to a person with hand_to_human rather than guessing.
- If they ask you to stop, or reply STOP, send nothing further.`

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
- Work toward a soft commitment with an assumptive close when their interest feels warm. Never pressure.

Pricing rules (follow exactly):
- You may state a price ONLY for something the knowledge explicitly marks as a fixed, published fee. State it naturally.
- Anything the knowledge marks as variable (priced by size, requires measuring) must NEVER be quoted — not even a range. Say a team member will confirm exact pricing.
${PROMPT_TEXT_RULES_COMMON}`,
}

const PROMPT_TEXT_HANDOFF = `When to hand the conversation to a person (use your hand_to_human tool, then send ONE short sign-off text and stop):
- They ask for a person, a specific teammate, or say they don't want to text with an assistant.
- They're upset, have a complaint, or describe an emergency or damage (a leak, flooding, water running, a safety issue). Lead with a sentence of empathy, then hand off.
- Billing: a balance, a charge, a payment, an invoice. Never read out or discuss amounts — hand off.
- They want to reschedule, cancel, or skip a visit, or change what's on an existing job. You cannot change the schedule; hand off.
- Anything your tools can't do or your knowledge doesn't cover, or a tool that keeps failing.
Until then, help them yourself — a person is watching this thread and can take over at any time, so you don't need to offer a callback for routine questions.`

function buildAmberTextTask(opts: {
  name: string
  baseLevel: 1 | 2 | 3
  canSchedule: boolean
  firstAmberMessage: boolean
  knownName: string | null
  notesBlock: string
}): string {
  const sections: string[] = [
    buildTodayLine(),
    `YOUR TASK — You are ${opts.name}, the company's virtual receptionist, answering a text to the company's number. Help them the way you would on a call: answer what you can from the company knowledge, look things up with your tools, get them booked when they want that, and hand the thread to a person the moment you hit something you can't handle.`,
    PROMPT_TEXT_STYLE,
  ]
  if (opts.firstAmberMessage) {
    sections.push(
      `IMPORTANT — this is your FIRST reply in this thread. Before anything else, briefly and naturally let them know they're texting with ${opts.name}, the company's virtual receptionist (for example, "Hi, this is ${opts.name}, the virtual receptionist for the team"). You must include this the first time. Never pretend to be a specific real person.`,
    )
  }
  if (opts.knownName) {
    sections.push(`THIS THREAD: the number matches an existing contact named ${opts.knownName}. Use their name naturally, but don't assume it's them — a family member may share the phone.`)
  }
  sections.push(PROMPT_TEXT_COLLECT, LEVEL_BEHAVIOR_TEXT[opts.baseLevel], CUSTOMER_SERVICE_INSTRUCTION)
  if (opts.canSchedule) sections.push(TEXT_SCHEDULING_INSTRUCTION)
  sections.push(PROMPT_TEXT_HANDOFF)
  if (opts.notesBlock) sections.push(opts.notesBlock) // LAST — the office's temporary instructions outrank everything above
  sections.push(`Reply with ONLY the exact text to send — no quotes, no labels, no commentary. Send at most one text.`)
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
  toolCtx: AmberToolContext
}): Promise<string> {
  const anthropic = getAnthropic({ timeout: 60_000, maxRetries: 2 })
  const tools = getAmberToolDefs(opts.toolCtx.canSchedule)
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
      console.log('[amber-text] generated', {
        conversationId: opts.toolCtx.conversationId,
        round: i,
        stop: response.stop_reason,
        chars: finalText.length,
        handedOff: Boolean(opts.toolCtx.handedOff),
      })
      break
    }
    console.log('[amber-text] tools', {
      conversationId: opts.toolCtx.conversationId,
      round: i,
      names: response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use').map((b) => b.name),
    })

    messages.push({ role: 'assistant', content: response.content })
    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of toolUseBlocks) {
      // Sequential on purpose: hand_to_human mutates the context the others read.
      const content = await runAmberTool(opts.admin, opts.toolCtx, block.name, block.input)
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  // Strip any stray voice markers (Amber over text never hangs up / transfers).
  return finalText.replace(/\[\[(END_CALL|VOICEMAIL|TRANSFER)\]\]/g, '').replace(/\s…$/, '').trim()
}
