// AI Voice Receptionist — Level 4 booking write (increment 3).
//
// Called by the voice WS service (~/lynxedo-voice) MID-CALL via the
// `book_appointment` tool (wired + gated to Level 4 in the voice service) after
// the caller agrees to a slot returned by /api/voice/availability. Creates a
// Jobber Request with the chosen slot attached as a scheduled assessment
// (startAt/endAt/assigned tech) — it lands in the Requests inbox for a human to
// confirm/convert. Dark until Level 4 is un-clamped.
//
// Scope (deliberately narrow — this WRITES to the live system of record):
//   • EXISTING Jobber customers only (we already have their property/address);
//     a new caller is captured for a human to book (via the existing wrap-up).
//   • Two commitment modes, per the service's `commitment` setting:
//       'request' — a Request + scheduled assessment for a human to confirm.
//       'direct'  — a real JOB with its line item, plus an Anytime visit.
//     'direct' used to be selectable but inert: this route called requestCreate
//     unconditionally and read `commitment` only to echo it back, so an admin who
//     chose Direct got a Request and no setting could change it. Ben, testing the
//     live line: *"I have it set so that she books the appointment versus putting
//     in a request, but my test, she put in a request."*
//   • Live new-client creation remains the documented fast-follow.
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
import { getEffectiveVoiceReceptionistSettings } from '@/lib/voice-receptionist-settings'
import {
  buildJobTitle,
  createJobberJob,
  createJobberVisit,
  findJobberProduct,
  neighborhoodFromClientHistory,
  primaryPropertyId,
} from '@/lib/voice-jobs'

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

  // While the receptionist is in test mode, tag what it creates so test bookings are
  // unmistakable and safe to bulk-delete. Hoisted above the direct path because BOTH
  // commitment modes tag their output.
  const testMode = process.env.VOICE_TEST_MODE === 'true'

  // ── DIRECT: a real job on the schedule ──────────────────────────────────────
  // Everything below this block is the Request path, unchanged. A company only gets
  // here by explicitly setting this service to Direct.
  //
  // Ordering is deliberate: every read that could fail happens BEFORE the first
  // write, so a missing product or property degrades into "a specialist will confirm"
  // rather than a half-built job. The one write we cannot make atomic is job-then-
  // visit; if the visit fails the job still exists, so we say so plainly instead of
  // claiming a time.
  if (svc.commitment === 'direct') {
    const vr = await getEffectiveVoiceReceptionistSettings(admin, companyId)

    const product = await findJobberProduct(userId, svc.line_item).catch(() => null)
    if (!product) {
      // The catalog is the source of price and wording; without it we would be
      // inventing both onto a real invoice.
      console.warn(`[voice.book] no Jobber product for "${svc.line_item}" — cannot direct-book`)
      return ok(
        "I can't put that straight on the schedule right now. Take the caller's details and let them know a specialist will confirm the appointment.",
        { booked: false, reason: 'product_not_found' },
      )
    }

    const propertyId = await primaryPropertyId(userId, jobberClientId).catch(() => null)
    if (!propertyId) {
      return ok(
        "I couldn't find their service address on file, so don't promise a time. Collect the address and let them know a specialist will confirm.",
        { booked: false, reason: 'no_property' },
      )
    }

    // Evidence, never inference — see neighborhoodFromClientHistory.
    const neighborhood = await neighborhoodFromClientHistory(
      admin,
      companyId,
      jobberClientId,
      vr.neighborhoods,
    ).catch(() => null)

    const template = (svc.job_title_template || '').trim() || svc.line_item
    const title = `${testMode ? '[TEST] ' : ''}${buildJobTitle(template, {
      price: product.unitPrice,
      neighborhood,
      service: svc.line_item,
      lastName: null,
    })}`

    // The office needs to know two things from the job itself: what the caller
    // actually said, and whether anything was left for a human. A missing
    // neighborhood is called out by name rather than left as a silently short title.
    const instructionLines = [
      `${testMode ? '[TEST booking via the AI receptionist — safe to delete] ' : ''}Booked on a call with the AI receptionist.`,
      startHHMM ? `Caller was offered a ${startHHMM}${endHHMM ? `\u2013${endHHMM}` : ''} arrival window.` : 'Booked as an Anytime visit.',
      neighborhood ? null : '\u26a0 Neighborhood could not be determined from this customer\u2019s previous jobs \u2014 please add it to the job title.',
    ].filter(Boolean) as string[]

    let created: { id: string; jobNumber: string | null; title: string }
    try {
      created = await createJobberJob(userId, {
        propertyId,
        title,
        instructions: instructionLines.join(' '),
        startDate: date,
        lineItem: { name: product.name, description: product.description, unitPrice: product.unitPrice },
      })
    } catch (err) {
      console.error('[voice.book] jobCreate failed', err)
      return ok(
        "I had trouble getting that on the schedule. Take the caller's details and a specialist will confirm the appointment.",
        { booked: false },
      )
    }

    // The visit is what puts it on the calendar. A window is passed through ONLY if
    // one was actually agreed; otherwise the time is omitted, which is what makes it
    // an Anytime visit — the shape this company's catalog says irrigation always uses.
    let visitOk = true
    try {
      await createJobberVisit(userId, {
        jobId: created.id,
        date,
        startHHMM: startHHMM || undefined,
        endHHMM: endHHMM || undefined,
        timezone: SCHEDULING_TZ,
        assignedUserIds: svc.assigned_user_ids,
      })
    } catch (err) {
      // The job exists and is real; only its calendar placement failed. Never report
      // this as a clean booking — the office has to place it.
      console.error('[voice.book] visitCreate failed', err)
      visitOk = false
    }

    // Recorded for the wrap-up, which surfaces it on the Office Alert (and on the
    // Lead Tracker row when the call produced one). ⚠ The wrap-up returns early
    // without creating a lead for 'scheduling' / 'existing_customer' calls, which is
    // what a booking call usually is — so this must not depend on a lead existing.
    await admin
      .from('voice_bookings')
      .insert({
        company_id: companyId,
        call_sid: typeof body.callSid === 'string' ? body.callSid : null,
        jobber_job_id: created.id,
        job_number: created.jobNumber,
        job_title: created.title,
        service_line_item: svc.line_item,
        booked_date: date,
        start_hhmm: startHHMM || null,
        end_hhmm: endHHMM || null,
        jobber_client_id: jobberClientId,
        neighborhood,
        needs_office_attention: !neighborhood || !visitOk,
      })
      .then(({ error }) => {
        if (error) console.warn('[voice.book] booking record failed', error.message)
      })

    const dLabel = dateLabelForSpeech(date)
    const answer = visitOk
      ? `Done \u2014 ${svc.line_item} is on the schedule for ${dLabel}${startHHMM ? `, arriving between ${startHHMM} and ${endHHMM || 'later that day'}` : ''}. Let the caller know warmly that they're booked${startHHMM ? '' : ", and tell them what your instructions say about when they'll hear their arrival window"}.`
      : `The job is created for ${dLabel} but it isn't on the calendar yet, so DON'T promise a time. Tell the caller they're booked in and the office will confirm the day's details.`

    return ok(answer, {
      booked: true,
      service: svc.line_item,
      date,
      dateLabel: dLabel,
      commitment: 'direct',
      jobNumber: created.jobNumber,
      scheduled: visitOk,
    })
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
