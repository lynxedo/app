// AI Voice Receptionist — Level 4 booking write (increment 3).
//
// Called by the voice WS service (~/lynxedo-voice) MID-CALL via the
// `book_appointment` tool (wired + gated to Level 4 in the voice service) after
// the caller agrees to a slot returned by /api/voice/availability. Creates a
// Jobber Request with the chosen slot attached as a scheduled assessment
// (startAt/endAt/assigned tech) — it lands in the Requests inbox for a human to
// confirm/convert. Dark until Level 4 is un-clamped.
//
// v1 scope (deliberately narrow — this WRITES to the live system of record):
//   • EXISTING Jobber customers only (we already have their property/address);
//     a new caller is captured for a human to book (via the existing wrap-up).
//   • Request-mode only (a human confirms). Direct auto-book (jobCreate) and
//     live new-client creation are the documented fast-follow.
//
// Auth: same Bearer VOICE_SERVICE_SECRET as the other /api/voice endpoints.

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { lookupByPhone } from '@/lib/dialer-lookup'
import { jobberGraphQLAdmin, companyJobberUserId } from '@/lib/jobber'
import { countBookedVisitsByDay } from '@/lib/voice-capacity'
import {
  SCHEDULING_TZ,
  dateLabelForSpeech,
  getSchedulableServices,
  getSchedulingEnabled,
  matchSchedulableService,
} from '@/lib/voice-scheduling'
import { getActiveVoiceNotes, bookingCapsForService } from '@/lib/voice-notes'

export const dynamic = 'force-dynamic'

const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function bearerAuthorized(request: Request): boolean {
  const secret = process.env.VOICE_SERVICE_SECRET || ''
  if (!secret) return false
  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return false
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Request + scheduled assessment. The assessment schedule is the ScheduledItem
// primitive (startAt/endAt/teamMemberIdsToAssign) confirmed via introspection.
const REQUEST_CREATE = `
  mutation AmberRequestCreate($input: RequestCreateInput!) {
    requestCreate(input: $input) {
      request { id }
      userErrors { message }
    }
  }
`

function ok(answer: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ answer, ...extra })
}

export async function POST(request: Request) {
  if (!bearerAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { from?: string; to?: string; callSid?: string; service?: string; date?: string; start?: string; end?: string } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    // handled below
  }
  const requested = typeof body.service === 'string' ? body.service : ''
  const date = typeof body.date === 'string' && YMD_RE.test(body.date) ? body.date : ''
  const startHHMM = typeof body.start === 'string' && HHMM_RE.test(body.start) ? body.start : ''
  const endHHMM = typeof body.end === 'string' && HHMM_RE.test(body.end) ? body.end : ''
  const from = typeof body.from === 'string' ? body.from : ''

  const companyId = HEROES_COMPANY_ID
  const admin = createAdminClient()

  if (!(await getSchedulingEnabled(admin, companyId))) {
    return ok("Booking isn't enabled — take the caller's details so a specialist can schedule.", { booked: false })
  }

  const services = (await getSchedulableServices(admin, companyId)).filter((s) => s.enabled)
  const svc = matchSchedulableService(services, requested)
  if (!svc) {
    return ok("I couldn't match that to a bookable service. Take the caller's details for a specialist to schedule.", { booked: false })
  }
  if (svc.mode === 'recurring') {
    return ok(
      `${svc.line_item} is a recurring sign-up, not a one-time appointment. Confirm they'd like to start and let them know a specialist will set up the first visit.`,
      { booked: false, mode: 'recurring' },
    )
  }
  if (!date) {
    return ok('I need a specific date to book. Ask the caller which day works and try again.', { booked: false })
  }
  if (!from) {
    return ok("There's no caller number to attach this to, so take the caller's details for a specialist to book.", { booked: false })
  }

  // ⚠ THE WRITE MUST RESOLVE LIKE THE READ. find_availability is where the per-day cap
  // is applied, but nothing forces Amber through it — the caller says "can you come
  // today?" and she can call book_appointment with that date directly. Enforcing the
  // note only in availability would leave Ben's *"we are booked for today. Do not book
  // any more"* trivially bypassed by the exact conversation it exists to prevent.
  //
  // Scoped to NOTE caps on purpose. The service's standing `max_per_day` is still not
  // enforced here (it never has been — this route has never counted existing visits);
  // retrofitting that would silently start refusing bookings that succeed today, which
  // is a separate change and not one that was asked for.
  const notes = await getActiveVoiceNotes(admin, companyId).catch(() => [])
  const noteCap = bookingCapsForService(notes, svc.line_item)[date]
  if (noteCap === 0) {
    return ok(
      `The office has closed ${dateLabelForSpeech(date)} to new ${svc.line_item} bookings, so don't book that day. Offer the caller another day, or take their details for a specialist to follow up.`,
      { booked: false, service: svc.line_item, date, blocked: true },
    )
  }

  // v1: live booking is for EXISTING customers (we already have their property).
  // A new caller is captured for a human to book — the wrap-up files the lead.
  let jobberClientId: string | null = null
  try {
    jobberClientId = (await lookupByPhone(from, companyId))?.jobberClientId ?? null
  } catch {
    // treat as new below
  }
  if (!jobberClientId) {
    return ok(
      "This looks like a new customer, so I can't put it straight on the schedule. Collect their name and full address, let them know a specialist will call to confirm the appointment, and it'll be captured for the team.",
      { booked: false, reason: 'new_client' },
    )
  }

  let userId = ''
  try {
    userId = (await companyJobberUserId(companyId, '')) || ''
  } catch {
    // handled below
  }
  if (!userId) {
    return ok("I can't reach the schedule right now. Take the caller's details so a specialist can confirm the time.", {
      booked: false,
    })
  }

  // A NUMERIC note cap ("up to 4 irrigation calls Monday the 31st") needs the day's
  // existing count, so it runs here rather than with the cheap 0-check above — and only
  // when such a cap actually exists for this date, so the normal booking path adds no
  // Jobber round-trip. Same counting helper find_availability uses, so the two paths
  // cannot disagree about how full a day is.
  if (typeof noteCap === 'number' && noteCap > 0) {
    const counts = await countBookedVisitsByDay({
      jobberUserId: userId,
      serviceLineItem: svc.line_item,
      fromYmd: date,
      toYmd: date,
    })
    if ((counts[date] ?? 0) >= noteCap) {
      return ok(
        `${dateLabelForSpeech(date)} is already at the limit the office set for ${svc.line_item}, so don't book it. Offer another day, or take the caller's details for a specialist to follow up.`,
        { booked: false, service: svc.line_item, date, blocked: true },
      )
    }
  }

  // Chosen slot → scheduled assessment (a human confirms the exact time). Whole
  // day when no window was offered/agreed.
  const schedule: Record<string, unknown> = {
    notifyTeam: true,
    startAt: { date, timezone: SCHEDULING_TZ, ...(startHHMM ? { time: `${startHHMM}:00` } : {}) },
  }
  if (endHHMM) schedule.endAt = { date, time: `${endHHMM}:00`, timezone: SCHEDULING_TZ }
  if (svc.assigned_user_ids.length) schedule.teamMemberIdsToAssign = svc.assigned_user_ids

  const windowNote = startHHMM ? ` — caller offered a ${startHHMM}${endHHMM ? `–${endHHMM}` : ''} arrival window` : ''
  // While the receptionist is in test mode (dark beta on the 888), tag the
  // Request so test bookings are unmistakable and safe to bulk-delete.
  const testMode = process.env.VOICE_TEST_MODE === 'true'
  const input = {
    clientId: jobberClientId,
    title: `${testMode ? '[TEST] ' : ''}${svc.line_item}`,
    assessment: {
      instructions: `${testMode ? '[TEST booking via the AI receptionist — safe to delete] ' : ''}Booked via the AI receptionist${windowNote}. Please confirm the exact time with the customer.`,
      schedule,
    },
  }

  try {
    const resp = await jobberGraphQLAdmin<{
      data: { requestCreate: { request: { id: string } | null; userErrors: { message: string }[] } }
    }>(userId, REQUEST_CREATE, { input })
    const userErrors = resp.data?.requestCreate?.userErrors ?? []
    if (userErrors.length) {
      console.error('[voice.book] requestCreate userErrors', userErrors)
      return ok(
        "I couldn't get that on the schedule just now. Reassure the caller and let them know a specialist will confirm the time shortly.",
        { booked: false, error: userErrors[0]?.message },
      )
    }
    if (!resp.data?.requestCreate?.request?.id) throw new Error('requestCreate returned no request id')
  } catch (err) {
    console.error('[voice.book] requestCreate failed', err)
    return ok(
      "I had trouble booking that just now. Take the caller's details and a specialist will confirm the appointment.",
      { booked: false },
    )
  }

  const label = dateLabelForSpeech(date)
  const answer = `Done — I've got ${svc.line_item} down for ${label}${startHHMM ? `, with a ${startHHMM} arrival window` : ''}. Let the caller know warmly that they're set and will get a confirmation shortly, and that a specialist will lock in the exact timing.`

  return ok(answer, { booked: true, service: svc.line_item, date, dateLabel: label, commitment: svc.commitment })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean(process.env.VOICE_SERVICE_SECRET),
    route: 'voice.book',
  })
}
