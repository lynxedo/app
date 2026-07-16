// Amber-over-text — the tools Amber can call while answering a drip SMS reply.
//
// Each mirrors a live voice-receptionist capability but returns a concise,
// text-friendly RESULT STRING (not a NextResponse) that the tool loop in
// lib/amber-text.ts feeds straight back to the model to read.
//
// ⚠ ZERO live-voice coupling. This file only IMPORTS the channel-neutral libs
//   (lib/dialer-lookup, lib/voice-scheduling, lib/jobber, and the pure decoders
//   exported from lib/voice-receptionist). It does NOT edit lib/voice-receptionist.ts
//   or any app/api/voice/* route. The Jobber query strings + slot/booking flow
//   are deliberately DUPLICATED from the voice routes so the live phone
//   receptionist is untouched (the integrator dedupes later).
//
// Everything is read-only except amberBookAppointment, which — exactly like
// /api/voice/book — creates a Jobber Request (a human confirms) and is gated by
// canSchedule (level >= 4 AND scheduling enabled), resolved by the caller.

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { lookupByPhone } from '@/lib/dialer-lookup'
import { jobberGraphQLAdmin, companyJobberUserId } from '@/lib/jobber'
import {
  decodeServiceFromLineItems,
  decodeServiceFromTitle,
} from '@/lib/voice-receptionist'
import { getEffectiveVoiceReceptionistSettings } from '@/lib/voice-receptionist-settings'
import {
  SCHEDULING_TZ,
  addDaysYmd,
  candidateDays,
  centralYmd,
  dateLabelForSpeech,
  firstOpenDay,
  getSchedulableServices,
  getSchedulingEnabled,
  matchSchedulableService,
  type TimeFrame,
} from '@/lib/voice-scheduling'

type Admin = ReturnType<typeof createAdminClient>

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

// ── Tool definitions offered to the model ────────────────────────────────────
// account_lookup takes NO args — the phone is the thread's number, injected by
// the dispatcher, so the model can never look up a different person's account.
const ACCOUNT_LOOKUP_TOOL: Anthropic.Tool = {
  name: 'account_lookup',
  description:
    "Look up the account for the person in THIS text thread: whether they're an existing customer, " +
    'their name and service address on file, and their next scheduled visit and its service. ' +
    'Use this whenever they ask about their account, when the team is coming, or what service is scheduled — ' +
    'never guess those; always look them up. Takes no input.',
  input_schema: { type: 'object', properties: {}, required: [] },
}

const FIND_AVAILABILITY_TOOL: Anthropic.Tool = {
  name: 'find_availability',
  description:
    'Find the first open appointment slot for a service the person wants to book. Call this BEFORE ' +
    'offering any day or time. Returns the earliest opening to offer — never invent a date or time.',
  input_schema: {
    type: 'object',
    properties: {
      service: { type: 'string', description: 'The service to book, e.g. "sprinkler service call".' },
    },
    required: ['service'],
  },
}

const BOOK_APPOINTMENT_TOOL: Anthropic.Tool = {
  name: 'book_appointment',
  description:
    'Book the appointment AFTER the person agrees to a slot returned by find_availability. Use the exact ' +
    'service, date (YYYY-MM-DD), and window from that result.',
  input_schema: {
    type: 'object',
    properties: {
      service: { type: 'string', description: 'The exact service name from find_availability.' },
      date: { type: 'string', description: 'The chosen date, YYYY-MM-DD, from find_availability.' },
      start: { type: 'string', description: 'Arrival window start, HH:MM 24-hour (optional).' },
      end: { type: 'string', description: 'Arrival window end, HH:MM 24-hour (optional).' },
    },
    required: ['service', 'date'],
  },
}

/** The tool set for a turn. Scheduling tools are only offered when canSchedule
 *  (level >= 4 AND scheduling enabled) — so Amber can't offer to book below L4. */
export function getAmberToolDefs(canSchedule: boolean): Anthropic.Tool[] {
  return canSchedule
    ? [ACCOUNT_LOOKUP_TOOL, FIND_AVAILABILITY_TOOL, BOOK_APPOINTMENT_TOOL]
    : [ACCOUNT_LOOKUP_TOOL]
}

/** Dispatch a tool_use block to its implementation. Never throws — returns an
 *  instructive string on any failure so the model can recover gracefully. */
export async function runAmberTool(
  admin: Admin,
  ctx: { companyId: string; phone: string | null; canSchedule: boolean },
  name: string,
  input: unknown,
): Promise<string> {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  try {
    if (name === 'account_lookup') {
      return await amberAccountLookup(admin, { companyId: ctx.companyId, phone: ctx.phone })
    }
    if (name === 'find_availability') {
      if (!ctx.canSchedule) {
        return "Booking isn't available on this line. Take their details and let them know a team member will schedule."
      }
      return await amberFindAvailability(admin, {
        companyId: ctx.companyId,
        service: typeof args.service === 'string' ? args.service : '',
      })
    }
    if (name === 'book_appointment') {
      if (!ctx.canSchedule) {
        return "Booking isn't available on this line. Take their details and let them know a team member will schedule."
      }
      return await amberBookAppointment(admin, {
        companyId: ctx.companyId,
        phone: ctx.phone,
        service: typeof args.service === 'string' ? args.service : '',
        date: typeof args.date === 'string' ? args.date : '',
        start: typeof args.start === 'string' ? args.start : '',
        end: typeof args.end === 'string' ? args.end : '',
      })
    }
    return `Unknown tool "${name}".`
  } catch (err) {
    console.warn('[amber-tools] tool failed', name, err)
    return "I couldn't complete that lookup just now. Take their details and let them know a team member will follow up."
  }
}

// ── account_lookup ───────────────────────────────────────────────────────────

// A client's upcoming visits across all their jobs (duplicated from
// /api/voice/lookup — see file header). VisitFilterAttributes has no client
// filter, so we traverse client -> jobs -> visits and pick the earliest in code.
const NEXT_VISIT_QUERY = `
  query AmberTextNextVisit($clientId: EncodedId!) {
    client(id: $clientId) {
      id
      jobs(first: 30) {
        nodes {
          id
          lineItems(first: 20) { nodes { name totalPrice } }
          visits(first: 5, filter: { status: UPCOMING }) {
            nodes { id title startAt completedAt lineItems(first: 20) { nodes { name totalPrice } } }
          }
        }
      }
    }
  }
`

type LineItemLite = { name: string | null; totalPrice: number | null }
type VisitLite = {
  id: string
  title: string | null
  startAt: string | null
  completedAt: string | null
  lineItems?: { nodes?: LineItemLite[] } | null
}
type JobLite = { id: string; lineItems?: { nodes?: LineItemLite[] } | null; visits?: { nodes?: VisitLite[] } | null }
type NextVisitResp = { data?: { client?: { jobs?: { nodes?: Array<JobLite | null> } } } }

/**
 * Identify the caller (via the channel-neutral lookupByPhone) and, when they're
 * an existing Jobber customer, add their next upcoming visit + service. Returns a
 * concise result string for the model. Never discloses balances or amounts owed
 * (see CUSTOMER_SERVICE_INSTRUCTION). Never throws.
 */
export async function amberAccountLookup(
  admin: Admin,
  opts: { companyId: string; phone: string | null },
): Promise<string> {
  const phone = (opts.phone || '').trim()
  if (!phone) {
    return "There's no phone number on this thread, so I can't pull up an account. Ask for their name and address and treat them as a new lead."
  }

  let match: Awaited<ReturnType<typeof lookupByPhone>> = null
  try {
    match = await lookupByPhone(phone, opts.companyId)
  } catch {
    // treated as no match below
  }

  const jobberClientId = match?.jobberClientId ?? null
  if (!jobberClientId) {
    return 'No existing customer account is on file for this number — treat them as a new lead. Capture their name, service address, and what they need.'
  }

  const lines: string[] = []
  const name = (match?.name && !match.nameIsCallerId ? match.name : '')?.trim()
  const statusWord = match?.status === 'archived' ? 'a past customer' : match?.status === 'lead' ? 'a lead' : 'an existing customer'
  lines.push(`This number matches ${statusWord}${name ? ` named ${name}` : ''}.`)
  if (match?.address) lines.push(`Service address on file: ${match.address}.`)

  // Next upcoming visit + service (best-effort live Jobber read).
  try {
    const userId = await companyJobberUserId(opts.companyId, '')
    if (userId) {
      const resp = await jobberGraphQLAdmin<NextVisitResp>(userId, NEXT_VISIT_QUERY, { clientId: jobberClientId })
      const today = centralYmd(new Date())
      const upcoming = (resp.data?.client?.jobs?.nodes ?? [])
        .flatMap((j) => (j?.visits?.nodes ?? []).map((v) => ({ v, jobLineItems: j?.lineItems?.nodes ?? [] })))
        .filter((x): x is { v: VisitLite; jobLineItems: LineItemLite[] } => Boolean(x.v && x.v.startAt && !x.v.completedAt))
        .filter((x) => centralYmd(new Date(x.v.startAt as string)) >= today)
        .map((x) => ({ ...x, t: Date.parse(x.v.startAt as string) }))
        .filter((x) => Number.isFinite(x.t))
        .sort((a, b) => a.t - b.t)
      if (upcoming.length) {
        const nextVisit = upcoming[0].v
        const visitItems = (nextVisit.lineItems?.nodes ?? []).filter(Boolean)
        const items = visitItems.length ? visitItems : upcoming[0].jobLineItems
        const settings = await getEffectiveVoiceReceptionistSettings(admin, opts.companyId)
        const service =
          decodeServiceFromLineItems(items, settings.titleServiceMap)?.say ??
          decodeServiceFromTitle(nextVisit.title, settings.titleServiceMap)
        const dateLabel = new Intl.DateTimeFormat('en-US', {
          timeZone: SCHEDULING_TZ,
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        }).format(new Date(nextVisit.startAt as string))
        lines.push(
          service
            ? `Their next scheduled visit is ${dateLabel}, for a ${service}. Share this warmly in your own words.`
            : `Their next scheduled visit is ${dateLabel}. The service type isn't clear, so give the date and say a team member can confirm what's included.`,
        )
      } else {
        lines.push('No upcoming visit is scheduled right now — let them know a team member will confirm and get them set up.')
      }
    }
  } catch (err) {
    console.warn('[amber-tools] next-visit lookup failed', err)
    lines.push("I couldn't pull their schedule just now — let them know a team member will confirm their next visit.")
  }

  lines.push('Do not read out any balance, amount owed, or specific charges; route billing questions to a team member.')
  return lines.join(' ')
}

// ── find_availability ────────────────────────────────────────────────────────

const PRODUCT_IDS_QUERY = `
  query AmberTextProductIds { productOrServices(first: 200) { nodes { id name } } }
`
const VISITS_QUERY = `
  query AmberTextAvailability($filter: VisitFilterAttributes) {
    visits(first: 100, filter: $filter) { nodes { id startAt } }
  }
`

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function formatWindows(frames: TimeFrame[]): string {
  const parts = frames.map((f) => `${to12h(f.start)} to ${to12h(f.end)}`)
  if (parts.length === 0) return ''
  if (parts.length === 1) return `an arrival window of ${parts[0]}`
  return `either ${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`
}

/**
 * First open appointment slot for a requested service — the company's scheduling
 * rules MINUS the existing Jobber calendar. Duplicated from /api/voice/availability
 * and returned as a text-friendly string. Read-only. Never throws.
 */
export async function amberFindAvailability(
  admin: Admin,
  opts: { companyId: string; service: string },
): Promise<string> {
  const { companyId } = opts
  if (!(await getSchedulingEnabled(admin, companyId))) {
    return "Booking isn't turned on, so don't offer to schedule. Take their details and let them know a team member will set up a time."
  }

  const services = (await getSchedulableServices(admin, companyId)).filter((s) => s.enabled)
  if (services.length === 0) {
    return "There aren't any services set up for booking yet. Take their details so a team member can schedule."
  }

  const svc = matchSchedulableService(services, opts.service)
  if (!svc) {
    const names = services.map((s) => s.line_item)
    return `I'm not sure which service they mean. The ones available to book are: ${names.join(', ')}. Ask which they'd like.`
  }

  if (svc.mode === 'recurring') {
    const freq = svc.frequencies.length ? ` They can choose ${svc.frequencies.join(' or ')}.` : ''
    return `${svc.line_item} is a recurring service, so don't pick an exact time.${freq} Confirm they'd like to get started and let them know a team member will lock in the first visit.`
  }

  const todayYmd = centralYmd(new Date())
  const days = candidateDays({
    todayYmd,
    leadDays: svc.lead_days,
    horizonDays: svc.horizon_days,
    offeredDays: svc.offered_days,
  })
  if (days.length === 0) {
    return "I couldn't find an available day in the booking window. Take their details so a team member can schedule."
  }

  let userId = ''
  try {
    userId = (await companyJobberUserId(companyId, '')) || ''
  } catch {
    // handled below
  }
  if (!userId) {
    return "I can't reach the schedule right now. Take their details so a team member can confirm a time."
  }

  // Scope the capacity count to THIS service when the product id resolves.
  let productId: string | null = null
  try {
    const p = await jobberGraphQLAdmin<{ data: { productOrServices: { nodes: { id: string; name: string }[] } } }>(
      userId,
      PRODUCT_IDS_QUERY,
      {},
    )
    const nm = svc.line_item.toLowerCase()
    productId = p.data?.productOrServices?.nodes?.find((n) => n.name.toLowerCase() === nm)?.id ?? null
  } catch {
    // leave null → unscoped count; request mode has a human check
  }

  const countByDay: Record<string, number> = {}
  try {
    const filter: Record<string, unknown> = {
      status: 'UPCOMING',
      startAt: {
        after: `${addDaysYmd(days[0], -1)}T00:00:00Z`,
        before: `${addDaysYmd(days[days.length - 1], 1)}T23:59:59Z`,
      },
    }
    if (productId) filter.productOrServiceId = productId
    const resp = await jobberGraphQLAdmin<{ data: { visits: { nodes: { id: string; startAt: string | null }[] } } }>(
      userId,
      VISITS_QUERY,
      { filter },
    )
    for (const v of resp.data?.visits?.nodes ?? []) {
      if (!v.startAt) continue
      const ymd = centralYmd(new Date(v.startAt))
      countByDay[ymd] = (countByDay[ymd] ?? 0) + 1
    }
  } catch (err) {
    console.warn('[amber-tools] availability visits query failed', err)
    // Fall through with empty counts — the human confirm step catches conflicts.
  }

  const openDay = firstOpenDay(days, countByDay, svc.max_per_day)
  if (!openDay) {
    return `We're fully booked for ${svc.line_item} within the next ${svc.horizon_days} days. Take their details so a team member can find the next opening.`
  }

  const label = dateLabelForSpeech(openDay)
  const windowPhrase = formatWindows(svc.time_frames)
  const firstWin = svc.time_frames[0]
  // Machine hint so the model books with exact args, not by re-parsing the label.
  const bookHint = ` [When they agree, call book_appointment with service="${svc.line_item}", date="${openDay}"${firstWin ? `, start="${firstWin.start}", end="${firstWin.end}"` : ''}.]`
  return (
    (windowPhrase
      ? `The first opening for ${svc.line_item} is ${label}, with ${windowPhrase}. If that works, confirm the details and then book it.`
      : `The first opening for ${svc.line_item} is ${label}. If that works, confirm the details and then book it.`) + bookHint
  )
}

// ── book_appointment ─────────────────────────────────────────────────────────

const REQUEST_CREATE = `
  mutation AmberTextRequestCreate($input: RequestCreateInput!) {
    requestCreate(input: $input) {
      request { id }
      userErrors { message }
    }
  }
`

/**
 * Create a Jobber Request with the chosen slot attached (a human confirms), for
 * EXISTING customers only. Duplicated from /api/voice/book and returned as a
 * text-friendly string. Gated by scheduling being enabled (the caller also gates
 * the tool on canSchedule = level >= 4). Never throws.
 */
export async function amberBookAppointment(
  admin: Admin,
  opts: { companyId: string; phone: string | null; service: string; date: string; start: string; end: string },
): Promise<string> {
  const { companyId } = opts
  if (!(await getSchedulingEnabled(admin, companyId))) {
    return "Booking isn't enabled — take their details so a team member can schedule."
  }

  const date = YMD_RE.test(opts.date) ? opts.date : ''
  const startHHMM = HHMM_RE.test(opts.start) ? opts.start : ''
  const endHHMM = HHMM_RE.test(opts.end) ? opts.end : ''

  const services = (await getSchedulableServices(admin, companyId)).filter((s) => s.enabled)
  const svc = matchSchedulableService(services, opts.service)
  if (!svc) {
    return "I couldn't match that to a bookable service. Take their details for a team member to schedule."
  }
  if (svc.mode === 'recurring') {
    return `${svc.line_item} is a recurring sign-up, not a one-time appointment. Confirm they'd like to start and let them know a team member will set up the first visit.`
  }
  if (!date) {
    return 'I need a specific date to book. Ask which day works and call find_availability again.'
  }
  if (!opts.phone) {
    return "There's no number to attach this to, so take their details for a team member to book."
  }

  // v1: live booking is for EXISTING customers (we already have their property).
  let jobberClientId: string | null = null
  try {
    jobberClientId = (await lookupByPhone(opts.phone, companyId))?.jobberClientId ?? null
  } catch {
    // treated as new below
  }
  if (!jobberClientId) {
    return "This looks like a new customer, so I can't put it straight on the schedule. Get their name and full address, let them know a team member will call to confirm the appointment, and it'll be captured for the team."
  }

  let userId = ''
  try {
    userId = (await companyJobberUserId(companyId, '')) || ''
  } catch {
    // handled below
  }
  if (!userId) {
    return "I can't reach the schedule right now. Take their details so a team member can confirm the time."
  }

  const schedule: Record<string, unknown> = {
    notifyTeam: true,
    startAt: { date, timezone: SCHEDULING_TZ, ...(startHHMM ? { time: `${startHHMM}:00` } : {}) },
  }
  if (endHHMM) schedule.endAt = { date, time: `${endHHMM}:00`, timezone: SCHEDULING_TZ }
  if (svc.assigned_user_ids.length) schedule.teamMemberIdsToAssign = svc.assigned_user_ids

  const windowNote = startHHMM ? ` — offered a ${startHHMM}${endHHMM ? `–${endHHMM}` : ''} arrival window` : ''
  const testMode = process.env.VOICE_TEST_MODE === 'true'
  const input = {
    clientId: jobberClientId,
    title: `${testMode ? '[TEST] ' : ''}${svc.line_item}`,
    assessment: {
      instructions: `${testMode ? '[TEST booking via Amber over text — safe to delete] ' : ''}Booked via Amber over text${windowNote}. Please confirm the exact time with the customer.`,
      schedule,
    },
  }

  try {
    const resp = await jobberGraphQLAdmin<{
      data: { requestCreate: { request: { id: string } | null; userErrors: { message: string }[] } }
    }>(userId, REQUEST_CREATE, { input })
    const userErrors = resp.data?.requestCreate?.userErrors ?? []
    if (userErrors.length) {
      console.error('[amber-tools] requestCreate userErrors', userErrors)
      return "I couldn't get that on the schedule just now. Reassure them and let them know a team member will confirm the time shortly."
    }
    if (!resp.data?.requestCreate?.request?.id) throw new Error('requestCreate returned no request id')
  } catch (err) {
    console.error('[amber-tools] requestCreate failed', err)
    return "I had trouble booking that just now. Take their details and a team member will confirm the appointment."
  }

  const label = dateLabelForSpeech(date)
  return `Done — ${svc.line_item} is down for ${label}${startHHMM ? `, with a ${startHHMM} arrival window` : ''}. Let them know warmly they're set and will get a confirmation, and that a team member will lock in the exact timing.`
}
