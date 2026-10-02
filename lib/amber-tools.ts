// Amber-over-text — the tools Amber can call while answering a text.
//
// Every lookup and booking tool calls the SAME website endpoint the phone
// receptionist uses (/api/voice/lookup, /availability, /book — loopback with the
// voice-service bearer), so text and phone can never drift: today's-visit lookup,
// the name-and-address fallback, open days ranked by neighborhood, time-frame titles and
// Anytime visits are one implementation. (The July 2026 version duplicated the
// Jobber queries here; that copy had already fallen behind by September.)
//
// hand_to_human is the one text-only tool: Amber's roadblock exit. It marks the
// thread handed off, posts to the Office Alerts room, and tells her to send a
// single sign-off text.

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { postOfficeAlert } from '@/lib/office-alerts'
import { formatPhone } from '@/lib/format'

type Admin = ReturnType<typeof createAdminClient>

export type AmberHandoffReason =
  | 'wants_person'
  | 'complaint_or_urgent'
  | 'billing'
  | 'schedule_change'
  | 'cant_help'
  | 'max_turns'
  | 'other'

export const HANDOFF_REASON_LABEL: Record<AmberHandoffReason, string> = {
  wants_person: 'asked for a person',
  complaint_or_urgent: 'complaint / urgent',
  billing: 'billing question',
  schedule_change: 'wants to reschedule or cancel',
  cant_help: 'outside what she can do',
  max_turns: 'reached her reply limit',
  other: 'needs a human',
}

export type AmberToolContext = {
  companyId: string
  conversationId: string
  threadId: string
  /** The thread's phone (E.164) — the ONLY number the tools ever look up. */
  phone: string | null
  contactName: string | null
  canSchedule: boolean
  lastInbound: string | null
  /** Set by hand_to_human so the turn runner knows this reply is the sign-off. */
  handedOff: { reason: AmberHandoffReason; summary: string } | null
}

// ── Tool definitions offered to the model ────────────────────────────────────

const ACCOUNT_LOOKUP_TOOL: Anthropic.Tool = {
  name: 'account_lookup',
  description:
    "Look up the account for the person in THIS text thread: their next scheduled visit (including one today) and what service it is. " +
    'Use it whenever they ask about their account, when the team is coming, or what service is scheduled — never guess those. ' +
    'It matches them by the number they are texting from; if it says the number is not on an account, ask what NAME the account ' +
    'is under and the service ADDRESS, then call it again passing both.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name the account is under, as they gave it — only when the number-based lookup found nothing.' },
      address: { type: 'string', description: 'The service address (street number and street, plus city or zip) — pass with `name` to narrow the match.' },
    },
    required: [],
  },
}

const FIND_AVAILABILITY_TOOL: Anthropic.Tool = {
  name: 'find_availability',
  description:
    'Find open appointment days for a service the company schedules. Call this BEFORE offering any day. It returns a short list of open DAYS, ' +
    "best fit for the person's area first, with instructions on how to offer them. Call it again with preferred_date when they ask about a specific day.",
  input_schema: {
    type: 'object',
    properties: {
      service: { type: 'string', description: 'The service to book, in plain words (e.g. "sprinkler service call", "lawn assessment").' },
      neighborhood: { type: 'string', description: 'The neighborhood, subdivision, or area they said they are in, if mentioned.' },
      zip: { type: 'string', description: 'The 5-digit zip of the service address, if given.' },
      preferred_date: { type: 'string', description: "A specific day they asked about, as YYYY-MM-DD (from TODAY'S DATE in your instructions). Omit for the normal search." },
    },
    required: ['service'],
  },
}

const BOOK_APPOINTMENT_TOOL: Anthropic.Tool = {
  name: 'book_appointment',
  description:
    'Book the appointment AFTER they agree to a day that find_availability returned. Pass the exact service and date, plus time_preference: ' +
    '"none" (default — no time promised, the preferred outcome), "am" or "pm" if they pushed back and chose morning or afternoon, or "window" with ' +
    'start and end when they need a specific arrival window from the list find_availability gave you.',
  input_schema: {
    type: 'object',
    properties: {
      service: { type: 'string', description: 'The service to book (same wording as find_availability).' },
      date: { type: 'string', description: 'The date as YYYY-MM-DD, exactly as given by find_availability.' },
      time_preference: { type: 'string', enum: ['none', 'am', 'pm', 'window', 'custom'], description: '"none" = flexible (default); "am"/"pm" = morning/afternoon; "custom" = a constraint they stated (also pass time_note); "window" = one of the office\'s firm windows (also pass start and end).' },
      time_note: { type: 'string', description: 'With time_preference "custom": the constraint in their words, short — "after 1pm", "before 10am", "not before noon".' },
      details: { type: 'string', description: "What they told you about the problem or the job, in a sentence or two, for the technician's note (e.g. 'Zone 3 not coming on; two heads leaking by the driveway; started last week')." },
      start: { type: 'string', description: 'Arrival-window start, HH:MM 24-hour — ONLY with time_preference "window".' },
      end: { type: 'string', description: 'Arrival-window end, HH:MM 24-hour — ONLY with time_preference "window".' },
    },
    required: ['service', 'date'],
  },
}

const HAND_TO_HUMAN_TOOL: Anthropic.Tool = {
  name: 'hand_to_human',
  description:
    'Hand this conversation to a real teammate and stop. Use it the moment you hit a roadblock: they ask for a person; they are upset, have a complaint, ' +
    'or describe an emergency or damage; they ask about billing, a balance, or a charge; they want to reschedule, cancel, or skip a visit; they need ' +
    'something your tools cannot do or your knowledge does not cover; or a tool keeps failing. It alerts the office. After it returns, send ONE short ' +
    'text telling them a teammate will take it from here, and nothing else.',
  input_schema: {
    type: 'object',
    properties: {
      reason: { type: 'string', enum: ['wants_person', 'complaint_or_urgent', 'billing', 'schedule_change', 'cant_help', 'other'], description: 'Why a human is needed.' },
      summary: { type: 'string', description: 'One or two sentences for the office: who they are, what they need, anything already settled.' },
    },
    required: ['reason', 'summary'],
  },
}

/** The tool set for a turn. Scheduling tools are offered only when canSchedule
 *  (level >= 4 AND scheduling enabled) — so Amber can't offer to book below L4. */
export function getAmberToolDefs(canSchedule: boolean): Anthropic.Tool[] {
  return canSchedule
    ? [ACCOUNT_LOOKUP_TOOL, FIND_AVAILABILITY_TOOL, BOOK_APPOINTMENT_TOOL, HAND_TO_HUMAN_TOOL]
    : [ACCOUNT_LOOKUP_TOOL, HAND_TO_HUMAN_TOOL]
}

// ── The phone receptionist's endpoints, called in-process over loopback ───────

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

async function voiceApi(path: string, body: Record<string, unknown>): Promise<string> {
  const base = (process.env.AMBER_TOOLS_API_BASE || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
  const secret = process.env.VOICE_SERVICE_SECRET || ''
  if (!base || !secret) {
    return "That lookup isn't available right now. Hand the thread to a person with hand_to_human."
  }
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  const data = (await res.json()) as { answer?: string }
  return data.answer || 'Nothing came back. Let them know a team member will confirm.'
}

/** Dispatch a tool_use block to its implementation. Never throws — returns an
 *  instructive string on any failure so the model can recover gracefully. */
export async function runAmberTool(
  admin: Admin,
  ctx: AmberToolContext,
  name: string,
  input: unknown,
): Promise<string> {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  // The thread's own number + a stable pseudo call id, so bookings made over text
  // are recorded against the conversation (voice_bookings.call_sid).
  const common = { from: ctx.phone, to: null, callSid: `txt:${ctx.conversationId}` }
  try {
    if (name === 'account_lookup') {
      return await voiceApi('/api/voice/lookup', {
        ...common,
        request: 'next_visit',
        name: str(args.name),
        address: str(args.address),
      })
    }
    if (name === 'find_availability') {
      if (!ctx.canSchedule) return "Booking isn't available over text. Take their details and let them know a team member will schedule."
      return await voiceApi('/api/voice/availability', {
        ...common,
        service: str(args.service) ?? '',
        neighborhood: str(args.neighborhood),
        zip: str(args.zip),
        preferred_date: str(args.preferred_date),
      })
    }
    if (name === 'book_appointment') {
      if (!ctx.canSchedule) return "Booking isn't available over text. Take their details and let them know a team member will schedule."
      return await voiceApi('/api/voice/book', {
        ...common,
        service: str(args.service) ?? '',
        date: str(args.date) ?? '',
        time_preference: str(args.time_preference),
        time_note: str(args.time_note),
        start: str(args.start),
        end: str(args.end),
        details: str(args.details),
      })
    }
    if (name === 'hand_to_human') {
      const reasonRaw = str(args.reason) ?? 'other'
      const reason = (Object.keys(HANDOFF_REASON_LABEL).includes(reasonRaw) ? reasonRaw : 'other') as AmberHandoffReason
      const summary = (str(args.summary) ?? '').slice(0, 600)
      await handThreadToHuman(admin, ctx, reason, summary)
      return 'Handed off — the office has been alerted. Now send ONE short, warm text telling them a teammate will take it from here (no questions, nothing else), and then stop.'
    }
    return `Unknown tool "${name}".`
  } catch (err) {
    console.warn('[amber-tools] tool failed', name, err)
    return "That didn't go through just now. If it's something they need an answer on, hand the thread to a person with hand_to_human; otherwise let them know a team member will follow up."
  }
}

/**
 * Mark the thread handed off and tell the office. Also used by the turn runner
 * for the reply-limit handoff (reason 'max_turns'). Best-effort on the alert; the
 * status write is what stops Amber.
 */
export async function handThreadToHuman(
  admin: Admin,
  ctx: Pick<AmberToolContext, 'companyId' | 'conversationId' | 'threadId' | 'phone' | 'contactName' | 'lastInbound'> & {
    handedOff?: AmberToolContext['handedOff']
  },
  reason: AmberHandoffReason,
  summary: string,
): Promise<void> {
  const now = new Date().toISOString()
  await admin
    .from('amber_text_threads')
    .update({ status: 'handed_off', handoff_reason: reason, handoff_summary: summary || null, handed_off_at: now, next_turn_at: null })
    .eq('id', ctx.threadId)
  ctx.handedOff = { reason, summary }

  const who = ctx.contactName?.trim() || (ctx.phone ? formatPhone(ctx.phone) || ctx.phone : 'Unknown')
  const phone = ctx.phone ? formatPhone(ctx.phone) || ctx.phone : null
  await postOfficeAlert(admin, ctx.companyId, {
    title: `💬 Amber needs a hand — ${who}${phone && phone !== who ? ` (${phone})` : ''} · ${HANDOFF_REASON_LABEL[reason]}`,
    details: [
      summary || null,
      ctx.lastInbound ? `Their last text: "${ctx.lastInbound.slice(0, 240)}"` : null,
      'The thread is waiting in the Hub Queue → /hub/txt — claim it to take over.',
    ],
  })
}
