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
import { jobberGraphQLAdmin, companyJobberUserId } from '@/lib/jobber'
import {
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

const PRODUCT_IDS_QUERY = `
  query AmberProductIds { productOrServices(first: 200) { nodes { id name } } }
`

// Root visits query, same shape the nightly sync uses. Filtered server-side to
// UPCOMING + a startAt window + (when resolvable) the specific product/service,
// so we count only this service's future bookings.
const VISITS_QUERY = `
  query AmberAvailability($filter: VisitFilterAttributes) {
    visits(first: 100, filter: $filter) {
      nodes { id startAt }
    }
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

  // Resolve the product/service id so the capacity count is scoped to THIS
  // service (best-effort; if it can't be resolved we still offer the earliest
  // allowed day — request mode has a human check before it's confirmed).
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
    // leave productId null → count falls back to unscoped/skip
  }

  // Count existing UPCOMING visits per Central day across the window (one query;
  // pad the UTC bounds a day each side, then bucket by Central calendar date).
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
    console.error('[voice.availability] visits query failed', err)
    // Fall through with empty counts — request mode's human step catches conflicts.
  }

  const openDay = firstOpenDay(days, countByDay, svc.max_per_day)
  if (!openDay) {
    return ok(
      `We're fully booked for ${svc.line_item} within the next ${svc.horizon_days} days. Take the caller's details so a specialist can find the next opening.`,
      { available: false, service: svc.line_item },
    )
  }

  const label = dateLabelForSpeech(openDay)
  const windowPhrase = formatWindows(svc.time_frames)
  const firstWin = svc.time_frames[0]
  // Machine hint so the model books with exact args (not by re-parsing the spoken
  // date). It's a bracketed directive the model acts on, not speech.
  const bookHint = ` [When the caller agrees, call book_appointment with service="${svc.line_item}", date="${openDay}"${firstWin ? `, start="${firstWin.start}", end="${firstWin.end}"` : ''}.]`
  const answer =
    (windowPhrase
      ? `The first opening for ${svc.line_item} is ${label}, with ${windowPhrase}. If that works, confirm the details with the caller and then book it.`
      : `The first opening for ${svc.line_item} is ${label}. If that works, confirm the details with the caller and then book it.`) + bookHint

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
