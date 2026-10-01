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
import { fanoutGuardianNotification } from '@/lib/guardian-post'
import { formatPhone } from '@/lib/format'
import { lookupByPhone } from '@/lib/dialer-lookup'
import { buildTodayLine, centralYmd, getSchedulingEnabled } from '@/lib/voice-scheduling'
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

/** "Thanks!", "Ok", "👍", a "Liked …" reaction — a closing, not a question. 60% of
 *  the same-day text-backs in the last two weeks were exactly this. Nobody should
 *  answer it: not Amber, and not a teammate woken by a DM. */
export function isBareAcknowledgment(body: string | null | undefined): boolean {
  const t = (body || '').trim()
  if (!t) return false
  if (/^(liked|loved|emphasized|laughed at|disliked|questioned)\s+[“"']/i.test(t)) return true // iMessage tapback
  if (/^[^A-Za-z0-9]{1,8}$/.test(t)) return true // emoji / punctuation only
  if (t.length > 40) return false
  const w = t.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim()
  const ACK = /^(ok|okay|k|kk|yes|yep|yeah|yup|no|nope|sure|thanks?|thank you|thank u|thx|ty|great|perfect|awesome|sounds good|got it|will do|good|cool|alright|all right|noted|received|roger|10 4|understood|you too|same to you|have a (great|good|nice) (day|one|weekend|evening)|no problem|np|appreciate it|much appreciated)$/
  // Allow a short name or sign-off tail: "Thanks Mike", "Ok thank you", "Thanks, have a great day"
  const parts = w.split(' ')
  if (ACK.test(w)) return true
  for (let i = 1; i < Math.min(parts.length, 4); i++) {
    const head = parts.slice(0, i).join(' ')
    const tail = parts.slice(i).join(' ')
    if (ACK.test(head) && (ACK.test(tail) || tail.split(' ').length <= 2)) return true
  }
  return false
}

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

  // Never answer the company's own numbers (a test from the other line, a relay),
  // and never a teammate texting the main line from their own cell.
  if (opts.phone) {
    const { data: own } = await admin.from('txt_phone_numbers').select('id').eq('company_id', opts.companyId).eq('twilio_number', opts.phone).limit(1)
    if (own && own.length) return { engage: false, dial, reason: 'internal_number' }
    // Admins are exempt — they're the ones who test her from their own phone.
    const last10 = opts.phone.replace(/\D/g, '').slice(-10)
    if (last10.length === 10) {
      const { data: staff } = await admin.from('user_profiles').select('id, phone, role').eq('company_id', opts.companyId).not('phone', 'is', null).is('deactivated_at', null)
      const hit = ((staff as { id: string; phone: string | null; role: string | null }[] | null) ?? []).some(
        (u) => u.role !== 'admin' && (u.phone || '').replace(/\D/g, '').slice(-10) === last10,
      )
      if (hit) return { engage: false, dial, reason: 'staff_number' }
    }
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
 * "Thanks!", "Ok", 👍 after something we sent needs no action from Amber at all —
 * no reply, no routing, no Amber record on the thread. It stays in the Queue
 * exactly as it does today, for a person to glance at. Ben: "I just would rather
 * a human make that decision than Amber." A first-ever text that happens to be
 * short ("Yes") is NOT this — there's nothing we said for it to acknowledge.
 */
export async function inboundNeedsNoReply(admin: Admin, conversationId: string, body: string | null): Promise<boolean> {
  if (!isBareAcknowledgment(body)) return false
  const { data } = await admin.from('txt_messages').select('id').eq('conversation_id', conversationId).eq('direction', 'outbound').limit(1)
  return Boolean(data && data.length)
}

/**
 * Ben's scenario (Oct 1 2026): Mike texts the customer during a treatment and
 * closes the thread; an hour later the customer texts a question for Mike. That
 * text should go back to Mike, not to Amber or the general Queue. So, before Amber
 * is offered an inbound: if a real teammate (not the bot) sent the last human text
 * in this thread EARLIER TODAY (Central), assign the thread to them, DM them from
 * the assistant with the message, and keep Amber out. The regular inbound push
 * then goes to the new owner because the thread is assigned by the time it runs.
 * Only while "Reply to texts" is on (it's part of her protocol). Returns the user
 * id it routed to, or null. Never throws.
 */
export async function routeInboundToTodaysTeammate(
  admin: Admin,
  opts: { companyId: string; conversationId: string; contactId: string | null; preview: string | null },
): Promise<string | null> {
  try {
    // Ben (Oct 1 2026): a bare "Thanks" / 👍 is never routed or assigned — it sits
    // in the Queue untouched so a person decides whether anything needs doing.
    if (isBareAcknowledgment(opts.preview)) return null
    const dial = await resolveAmberDial(admin, opts.companyId)
    if (!dial.on) return null

    const { data: convData } = await admin
      .from('txt_conversations')
      .select('id, kind, status, assigned_to')
      .eq('id', opts.conversationId)
      .maybeSingle()
    const conv = convData as { kind: string | null; status: string | null; assigned_to: string | null } | null
    if (!conv || (conv.kind || 'direct') !== 'direct') return null
    if (conv.status !== 'unassigned' || conv.assigned_to) return null

    // The most recent outbound in the last day, with who sent it.
    const { data: outs } = await admin
      .from('txt_messages')
      .select('sent_by, is_ai, created_at')
      .eq('conversation_id', opts.conversationId)
      .eq('direction', 'outbound')
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
    const last = ((outs as { sent_by: string | null; is_ai: boolean | null; created_at: string }[] | null) ?? [])[0]
    if (!last || last.is_ai || !last.sent_by) return null
    if (dial.botUserId && last.sent_by === dial.botUserId) return null
    if (centralYmd(new Date(last.created_at)) !== centralYmd(new Date())) return null // earlier TODAY only

    // A real, active teammate who can work texts.
    const { data: prof } = await admin
      .from('user_profiles')
      .select('id, role, can_access_txt, deactivated_at, locked_at')
      .eq('id', last.sent_by)
      .eq('company_id', opts.companyId)
      .maybeSingle()
    const u = prof as { id: string; role: string | null; can_access_txt: boolean | null; deactivated_at: string | null; locked_at: string | null } | null
    if (!u || u.deactivated_at || u.locked_at) return null
    if (!(u.role === 'admin' || u.can_access_txt)) return null
    const { data: bot } = await admin.from('hub_users').select('is_bot').eq('id', u.id).maybeSingle()
    if ((bot as { is_bot?: boolean } | null)?.is_bot) return null

    // Assign — mirrors app/api/txt/conversations/[id]/assign.
    await admin.from('txt_conversation_members').delete().eq('conversation_id', opts.conversationId).eq('role', 'owner')
    await admin.from('txt_conversation_members').delete().match({ conversation_id: opts.conversationId, user_id: u.id })
    await admin.from('txt_conversation_members').insert({ conversation_id: opts.conversationId, user_id: u.id, role: 'owner', added_by: dial.botUserId ?? u.id })
    const { error: updErr } = await admin
      .from('txt_conversations')
      .update({ assigned_to: u.id, status: 'assigned' })
      .eq('id', opts.conversationId)
      .eq('status', 'unassigned')
    if (updErr) return null
    // Amber stays out of it from here.
    await admin.from('amber_text_threads').upsert(
      { company_id: opts.companyId, conversation_id: opts.conversationId, status: 'human', next_turn_at: null },
      { onConflict: 'conversation_id' },
    )

    let who = 'A customer'
    if (opts.contactId && UUID_RE.test(opts.contactId)) {
      const { data: c } = await admin.from('txt_contacts').select('name, phone').eq('id', opts.contactId).maybeSingle()
      const cc = c as { name: string | null; phone: string | null } | null
      who = cc?.name?.trim() || (cc?.phone ? formatPhone(cc.phone) || cc.phone : who)
    }
    const preview = (opts.preview || '').trim()
    const body =
      `📱 ${who} texted back after your conversation with them earlier today, so I put it in your Txt inbox instead of answering myself.` +
      (preview ? `\n\n"${preview.length > 240 ? preview.slice(0, 237) + '…' : preview}"` : '') +
      `\n\nOpen it: /hub/txt/${opts.conversationId}`
    await fanoutGuardianNotification({ companyId: opts.companyId, userIds: [u.id], roomIds: [], body, admin })
    console.log('[amber-text] routed to today\'s teammate', { conversationId: opts.conversationId, userId: u.id })
    return u.id
  } catch (err) {
    console.warn('[amber-text] routeInboundToTodaysTeammate failed', opts.conversationId, err)
    return null
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
    const lastInbound = (last.body || '').trim() || null
    const priorOutbound = messages.slice(0, -1).some((m) => m.direction === 'outbound')
    if (priorOutbound && isBareAcknowledgment(lastInbound) && !(Array.isArray(last.media_urls) && last.media_urls.length)) {
      // A closing ("Thanks!", "Ok", 👍) after something we sent needs no answer.
      return skip(conversationId, 'bare_acknowledgment')
    }

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
    console.log('[amber-text] SENT', { conversationId, turn: thread.turn_count + 1, chars: finalText.length, handedOff: handedOffThisTurn })
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

const PROMPT_TEXT_STYLE_TEMPLATE = `How to text:
- This is a live SMS conversation. Keep EVERY reply short — one or two sentences, the way a real person texts. Ask for ONE thing at a time and wait for their answer. Never send a long paragraph, a list, or several questions at once.
- Plain text only: no markdown, asterisks, bullet points, emoji, links, or formatting. Write numbers, dates, and times the way a person would type them.
- Be warm, friendly, and human. Acknowledge what they said before moving on. Don't repeat an empathetic line more than once.
- Don't say "hey there" or re-greet someone mid-conversation, and don't repeat the company name back to them.
- Don't announce that you're an assistant or a bot, and never sign your texts with a title. If they ask whether they're texting a real person, or who you are, say you're ${'{'}NAME{'}'}, the team's virtual assistant — never claim to be human, and never pretend to be a specific teammate.
- If they send a photo or attachment, you can't view it over text: say so plainly, and if seeing it matters (a leak, damage, a part), hand the thread to a person.`

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
  knownName: string | null
  notesBlock: string
}): string {
  // Ben (Oct 1 2026): no up-front "I'm a virtual receptionist" over text — it reads
  // oddly in SMS; she identifies as the team's virtual assistant only when asked.
  const sections: string[] = [
    buildTodayLine(),
    `YOUR TASK — You are ${opts.name}, answering a text to the company's number on behalf of the team. Help them the way you would on a call: answer what you can from the company knowledge, look things up with your tools, get them booked when they want that, and hand the thread to a person the moment you hit something you can't handle.`,
    PROMPT_TEXT_STYLE_TEMPLATE.replace(/\{NAME\}/g, opts.name),
  ]
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
