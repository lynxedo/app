// AI Voice Receptionist — Level 4 availability lookup.
//
// Called by the voice WS service (~/lynxedo-voice) MID-CALL when the caller wants
// to book a service (the `find_availability` tool). Given a requested service, it
// computes the open appointment days from the company's scheduling config (Admin →
// AI → Receptionist → Scheduling) MINUS what's already on the Jobber calendar, and
// returns natural-language guidance for the assistant to speak plus structured
// fields the `book_appointment` tool reuses. Read-only: this never writes to Jobber.
//
// Sep 30 2026 — it used to return exactly ONE day. When that day didn't suit the
// caller Amber said "that's the only day I have", because it was: the tool had
// nothing else to say. It now returns up to three open days, ranked by how well
// they fit the caller's area (lib/voice-affinity.ts — a day where the tech already
// has stops in the caller's neighborhood beats an earlier empty one), and can check
// a specific day the caller asks for (`preferred_date`). It also stops pushing the
// arrival windows up front: the day is offered on its own, and the windows are
// listed only as the fallback for a caller who truly needs a specific time.
//
// Auth: same Bearer VOICE_SERVICE_SECRET as the other /api/voice endpoints.

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { companyJobberUserId } from '@/lib/jobber'
import { countBookedVisitsByDay } from '@/lib/voice-capacity'
import { lookupByPhone } from '@/lib/dialer-lookup'
import {
  addDaysYmd,
  candidateDays,
  centralYmd,
  dateLabelForSpeech,
  getSchedulableServices,
  getSchedulingEnabled,
  matchSchedulableService,
  openDays,
  weekdayOfYmd,
  type TimeFrame,
} from '@/lib/voice-scheduling'
import { getActiveVoiceNotes, bookingCapsForService, isDayFullyBlocked } from '@/lib/voice-notes'
import { getEffectiveVoiceReceptionistSettings } from '@/lib/voice-receptionist-settings'
import { nearbyStopsByDay, resolveCallerLocale, type DayStops } from '@/lib/voice-affinity'

export const dynamic = 'force-dynamic'

const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

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
  return frames.map((f) => `${to12h(f.start)} to ${to12h(f.end)} (start="${f.start}", end="${f.end}")`).join('; ')
}

function ok(answer: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ answer, ...extra })
}

type RankedDay = { date: string; label: string; stops: DayStops; score: number; soonest: boolean }

export async function POST(request: Request) {
  if (!bearerAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: {
    from?: string
    to?: string
    callSid?: string
    service?: string
    neighborhood?: string
    zip?: string
    preferred_date?: string
  } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    // handled below
  }
  const requested = typeof body.service === 'string' ? body.service : ''
  const spokenNeighborhood = typeof body.neighborhood === 'string' ? body.neighborhood.trim() : ''
  const spokenZip = typeof body.zip === 'string' ? body.zip.trim() : ''
  const preferred = typeof body.preferred_date === 'string' && YMD_RE.test(body.preferred_date.trim()) ? body.preferred_date.trim() : ''

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

  // Appointment mode → the open days from the rules.
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

  const open = openDays(days, countByDay, svc.max_per_day, capOverrides, 6)
  if (!open.length) {
    return ok(
      `We're fully booked for ${svc.line_item} within the next ${svc.horizon_days} days. Take the caller's details so a specialist can find the next opening.`,
      { available: false, service: svc.line_item },
    )
  }

  // Where the caller is — their own record if we know them, else what they said.
  const vr = await getEffectiveVoiceReceptionistSettings(admin, companyId)
  let jobberClientId: string | null = null
  if (body.from) {
    try {
      jobberClientId = (await lookupByPhone(body.from, companyId))?.jobberClientId ?? null
    } catch {
      // unknown caller
    }
  }
  const locale = await resolveCallerLocale(admin, companyId, {
    jobberClientId,
    spokenNeighborhood: spokenNeighborhood || null,
    spokenZip: spokenZip || null,
    neighborhoods: vr.neighborhoods,
  }).catch(() => ({ neighborhood: null, zip: null, source: null as null }))

  const stopsByDay = await nearbyStopsByDay(admin, companyId, {
    fromYmd: open[0],
    toYmd: open[open.length - 1],
    techIds: svc.assigned_user_ids,
    neighborhood: locale.neighborhood,
    zip: locale.zip,
    neighborhoods: vr.neighborhoods,
  }).catch(() => ({}) as Record<string, DayStops>)

  const rank = (ymd: string): RankedDay => {
    const stops = stopsByDay[ymd] ?? { total: 0, sameNeighborhood: 0, sameZip: 0 }
    // Neighborhood stops outrank zip stops outrank nothing; within a tier, more
    // stops win; the date breaks ties in the sort below.
    const score = stops.sameNeighborhood > 0 ? 100 + stops.sameNeighborhood : stops.sameZip > 0 ? 10 + stops.sameZip : 0
    return { date: ymd, label: dateLabelForSpeech(ymd), stops, score, soonest: ymd === open[0] }
  }
  const ranked = open.map(rank).sort((a, b) => b.score - a.score || a.date.localeCompare(b.date))
  // The two best fits plus the soonest open day, so "as early as possible" is always
  // one of the offers even when a later day fits the route better.
  const chosen = ranked.slice(0, 2)
  const soonest = ranked.find((d) => d.soonest)
  if (soonest && !chosen.some((d) => d.date === soonest.date)) chosen.push(soonest)
  else if (ranked[2]) chosen.push(ranked[2])
  chosen.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date))

  const nearbyPhrase = (d: RankedDay): string => {
    if (d.stops.sameNeighborhood > 0 && locale.neighborhood) {
      return `the tech already has ${d.stops.sameNeighborhood} stop${d.stops.sameNeighborhood === 1 ? '' : 's'} in ${locale.neighborhood} that day`
    }
    if (d.stops.sameZip > 0) return `${d.stops.sameZip} stop${d.stops.sameZip === 1 ? '' : 's'} in the caller's zip that day`
    return 'nothing near them on the books that day yet'
  }
  const describeDay = (d: RankedDay, i: number): string => {
    const tags = [i === 0 && d.score > 0 ? 'best fit' : null, d.soonest ? 'soonest' : null].filter(Boolean).join(', ')
    return `${d.label} [${d.date}]${tags ? ` (${tags}; ` : ' ('}${nearbyPhrase(d)})`
  }

  // A day the office closed by note is SKIPPED, not treated as "no availability" — a
  // caller phoning at 2pm on a full day should still be able to book Wednesday. When
  // that skip is why the offer moved, say so.
  const skippedToday = days[0] !== open[0] && isDayFullyBlocked(notes, days[0])
  const fullPrefix = skippedToday ? "Today's schedule is full, so don't offer today. " : ''

  // A tool result is the most specific thing the model has heard and it arrives last,
  // so it beats a standing prompt note by default — which is exactly backwards. Say
  // here, in the channel that was overriding it, that the office's notes win. Name
  // the block EXACTLY as buildNotesBlock titles it in the prompt.
  const deferToNotes = notes.length
    ? " TODAY'S INSTRUCTIONS FROM THE OFFICE outrank this result: if they say how to handle timing, what to offer, or what to say, follow them instead of this suggestion."
    : ''

  const windowsLine = svc.time_frames.length
    ? ` Offer the DAY only, no time (see your booking rules). Only if the caller truly needs a specific time, the arrival windows the office can commit to are: ${formatWindows(svc.time_frames)} — pick the one that fits and pass its start and end with time_preference="window".`
    : ' Offer the DAY only, no time (see your booking rules).'
  const dateList = chosen.map((d) => d.date).join(' | ')
  const bookHint = ` [When the caller agrees, call book_appointment with service="${svc.line_item}", date= the accepted day's date EXACTLY as listed (${dateList}), and time_preference="none" unless they asked for a time ("am" / "pm", or "window" with start/end from the list above).]`

  // A specific day the caller asked about ("can you do Thursday?").
  if (preferred) {
    const hit = ranked.find((d) => d.date === preferred)
    let why: string | null = null
    if (!hit) {
      if (preferred < todayYmd) why = 'that date is in the past'
      else if (preferred < days[0]) why = `the earliest the office books ${svc.line_item} is ${dateLabelForSpeech(days[0])}`
      else if (preferred > days[days.length - 1]) why = `that's further out than the office books right now`
      else if (svc.offered_days.length && !svc.offered_days.includes(weekdayOfYmd(preferred))) {
        why = `the office doesn't book ${svc.line_item} on ${DAY_NAMES[weekdayOfYmd(preferred)]}s`
      } else why = 'that day is already full'
    }
    const alternatives = chosen.filter((d) => d.date !== preferred)
    const altText = alternatives.length
      ? ` The closest open days are: ${alternatives.map(describeDay).join('; ')}. Offer the first of those.`
      : ''
    const answer = hit
      ? `${fullPrefix}${hit.label} is open for ${svc.line_item} (${nearbyPhrase(hit)}) — you can book it.${windowsLine}${deferToNotes} [When the caller agrees, call book_appointment with service="${svc.line_item}", date="${hit.date}", and time_preference="none" unless they asked for a time.]`
      : `${fullPrefix}${dateLabelForSpeech(preferred)} isn't available — ${why}.${altText}${windowsLine}${deferToNotes}${alternatives.length ? bookHint : ''}`
    return ok(answer, {
      available: Boolean(hit || alternatives.length),
      mode: 'appointment',
      service: svc.line_item,
      preferredDate: preferred,
      preferredOpen: Boolean(hit),
      reason: why,
      date: hit?.date ?? alternatives[0]?.date ?? null,
      dateLabel: hit?.label ?? alternatives[0]?.label ?? null,
      days: (hit ? [hit, ...alternatives] : alternatives).map((d) => ({ date: d.date, label: d.label, ...d.stops, soonest: d.soonest })),
      windows: svc.time_frames,
      commitment: svc.commitment,
      locale,
    })
  }

  const first = chosen[0]
  const ordering = chosen.length > 1
    ? ` Offer ${first.label} first${first.score > 0 ? ` — it's the best fit for their area` : ''}. If it doesn't suit them, offer the next day on this list, one at a time — do NOT read the whole list, and never say a day is the only one you have.`
    : ' Offer it; if it doesn\'t work, take the caller\'s details so a specialist can find another day.'
  const answer =
    `${fullPrefix}Open days for ${svc.line_item}, best fit first: ${chosen.map(describeDay).join('; ')}.` +
    ordering +
    windowsLine +
    deferToNotes +
    bookHint

  return ok(answer, {
    available: true,
    mode: 'appointment',
    service: svc.line_item,
    date: first.date,
    dateLabel: first.label,
    days: chosen.map((d) => ({ date: d.date, label: d.label, ...d.stops, soonest: d.soonest })),
    windows: svc.time_frames,
    commitment: svc.commitment,
    locale,
    horizonEnd: addDaysYmd(todayYmd, svc.horizon_days),
  })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean(process.env.VOICE_SERVICE_SECRET),
    route: 'voice.availability',
  })
}
