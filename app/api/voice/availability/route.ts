// AI Voice Receptionist — Level 4 availability lookup (increment 2).
//
// Called by the voice WS service (~/lynxedo-voice) MID-CALL when the caller wants
// to book a service (the `find_availability` tool, wired in increment 3). Given a
// requested service, it computes the first open appointment slot from the
// company's scheduling config (Admin → AI → Receptionist → Scheduling) MINUS
// what's already on the Jobber calendar, and returns natural-language guidance
// for the assistant to speak plus structured fields the `book_appointment` tool
// reuses. Read-only: this never writes to Jobber.
//
// Dark until increment 3 wires the tool + Level 4 is un-clamped. Auth: same
// Bearer VOICE_SERVICE_SECRET as the other /api/voice endpoints.

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { companyJobberUserId } from '@/lib/jobber'
import { countBookedVisitsByDay } from '@/lib/voice-capacity'
import {
  candidateDays,
  centralYmd,
  dateLabelForSpeech,
  firstOpenDay,
  getSchedulableServices,
  getSchedulingEnabled,
  matchSchedulableService,
  type TimeFrame,
} from '@/lib/voice-scheduling'
import { getActiveVoiceNotes, bookingCapsForService, isDayFullyBlocked } from '@/lib/voice-notes'

export const dynamic = 'force-dynamic'

const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

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

function ok(answer: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ answer, ...extra })
}

export async function POST(request: Request) {
  if (!bearerAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { from?: string; to?: string; callSid?: string; service?: string } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    // handled below
  }
  const requested = typeof body.service === 'string' ? body.service : ''

  const companyId = HEROES_COMPANY_ID
  const admin = createAdminClient()

  // Master switch — if scheduling is off, don't offer to book.
  if (!(await getSchedulingEnabled(admin, companyId))) {
    return ok(
      "Booking isn't turned on, so don't offer to schedule. Take the caller's details and let them know a specialist will call to set up a time.",
      { available: false },
    )
  }

  const services = (await getSchedulableServices(admin, companyId)).filter((s) => s.enabled)
  if (services.length === 0) {
    return ok(
      "There aren't any services set up for booking yet. Take the caller's details so a specialist can schedule.",
      { available: false },
    )
  }

  const svc = matchSchedulableService(services, requested)
  if (!svc) {
    const names = services.map((s) => s.line_item)
    return ok(
      `I'm not certain which service they mean. The ones available to book are: ${names.join(', ')}. Ask which they'd like.`,
      { available: false, schedulable: names },
    )
  }

  // Recurring service → no live slot; capture the sign-up (enroll-lite).
  if (svc.mode === 'recurring') {
    const freq = svc.frequencies.length ? ` They can choose ${svc.frequencies.join(' or ')}.` : ''
    return ok(
      `${svc.line_item} is a recurring service, so don't pick an exact time.${freq} Confirm they'd like to get started and let them know a specialist will call to lock in the first visit.`,
      { available: true, mode: 'recurring', service: svc.line_item, frequencies: svc.frequencies },
    )
  }

  // Appointment mode → compute the first open day from the rules.
  const todayYmd = centralYmd(new Date())
  const days = candidateDays({
    todayYmd,
    leadDays: svc.lead_days,
    horizonDays: svc.horizon_days,
    offeredDays: svc.offered_days,
  })
  if (days.length === 0) {
    return ok(
      "I couldn't find an available day in the booking window. Take the caller's details so a specialist can schedule.",
      { available: false, service: svc.line_item },
    )
  }

  let userId = ''
  try {
    userId = (await companyJobberUserId(companyId, '')) || ''
  } catch {
    // handled below
  }
  if (!userId) {
    return ok(
      "I'm having trouble reaching the schedule right now. Take the caller's details so a specialist can confirm a time.",
      { available: false, service: svc.line_item },
    )
  }

  const countByDay = await countBookedVisitsByDay({
    jobberUserId: userId,
    serviceLineItem: svc.line_item,
    fromYmd: days[0],
    toYmd: days[days.length - 1],
  })

  // "Right Now" notes can replace max_per_day for specific days — Ben's *"up to 4
  // irrigation service calls for Monday the 31st"* and *"we are booked for today"*.
  // WITHOUT this the tool would compute an opening from the standing cap and hand
  // Amber a sentence telling her to book it, directly contradicting the note she is
  // reading in her own prompt. Non-fatal: a notes failure leaves caps empty, which is
  // the pre-feature behaviour.
  const notes = await getActiveVoiceNotes(admin, companyId).catch(() => [])
  const capOverrides = bookingCapsForService(notes, svc.line_item)

  const openDay = firstOpenDay(days, countByDay, svc.max_per_day, capOverrides)
  if (!openDay) {
    return ok(
      `We're fully booked for ${svc.line_item} within the next ${svc.horizon_days} days. Take the caller's details so a specialist can find the next opening.`,
      { available: false, service: svc.line_item },
    )
  }

  // A day the office closed by note is SKIPPED, not treated as "no availability" — a
  // caller phoning at 2pm on a full day should still be able to book Wednesday. Ben's
  // *"we are booked for today. Do not book any more"* reads as "nothing else onto
  // TODAY", not "stop booking work". When that skip is why the offer moved, say so, so
  // she frames it as today being full rather than the next slot being a week out for
  // no stated reason.
  const skippedToday = days[0] !== openDay && isDayFullyBlocked(notes, days[0])

  const label = dateLabelForSpeech(openDay)
  const windowPhrase = formatWindows(svc.time_frames)
  const firstWin = svc.time_frames[0]
  // Machine hint so the model books with exact args (not by re-parsing the spoken
  // date). It's a bracketed directive the model acts on, not speech.
  //
  // The window args are OPTIONAL on purpose. Spelling them out unconditionally made
  // this hint the most specific instruction in the whole call — more specific than
  // the deferral below and more specific than any note — so Amber always pinned a
  // time, even under a note saying to book anytime and text the window the day
  // before. Omitting start/end books a date-only (anytime) visit, which is what the
  // book route already does with them absent.
  const bookHint = ` [When the caller agrees, call book_appointment with service="${svc.line_item}", date="${openDay}"${
    firstWin
      ? `. Add start="${firstWin.start}" and end="${firstWin.end}" ONLY if you actually offered that window and the caller accepted it; omit both to book it as an anytime visit`
      : ''
  }.]`
  const fullPrefix = skippedToday
    ? "Today's schedule is full, so don't offer today. "
    : ''
  // A tool result is the most specific thing the model has heard and it arrives last,
  // so it beats a standing prompt note by default — which is exactly backwards. Ben,
  // on his "Right Now" notes: *"my temporary instructions are meant to supersede...
  // That is the whole point."* His note says to book these as anytime visits and let
  // the customer know they'll get a three-hour window texted the day before; this
  // tool was handing Amber three specific windows and telling her to offer one, and
  // the tool won. The prompt-side block already claims precedence; say it HERE too,
  // in the channel that was overriding it.
  //
  // Deliberately generic — it defers to whatever the note says rather than encoding
  // any one company's timing policy — and only emitted when a note is actually in
  // force, so a company with no notes reads exactly the sentence it always did.
  // Name the block EXACTLY as buildNotesBlock titles it in the prompt. Pointing at
  // "your Right Now notes" (the feature's name in the admin UI) would be pointing at
  // a heading the model never sees — the prompt calls it TODAY'S INSTRUCTIONS FROM
  // THE OFFICE. A precedence rule that names the wrong thing is a precedence rule the
  // model has to guess at, which is the failure this whole line exists to stop.
  const deferToNotes = notes.length
    ? " TODAY'S INSTRUCTIONS FROM THE OFFICE outrank this result: if they say how to handle timing, what to offer, or what to say, follow them instead of this suggestion."
    : ''
  const answer =
    fullPrefix +
    (windowPhrase
      ? `The first opening for ${svc.line_item} is ${label}, with ${windowPhrase}. If that works, confirm the details with the caller and then book it.`
      : `The first opening for ${svc.line_item} is ${label}. If that works, confirm the details with the caller and then book it.`) +
    deferToNotes +
    bookHint

  return ok(answer, {
    available: true,
    mode: 'appointment',
    service: svc.line_item,
    date: openDay,
    dateLabel: label,
    windows: svc.time_frames,
    commitment: svc.commitment,
  })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean(process.env.VOICE_SERVICE_SECRET),
    route: 'voice.availability',
  })
}
