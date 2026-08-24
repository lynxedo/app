// Amber's "Right Now" notes — temporary instructions that outrank the Knowledge Base.
//
// Ben, Aug 24 2026: *"my temporary instructions are meant to supersede what is in the
// knowledge base. That is the whole point. That way we can customize how she works from
// day to day."*
//
// A note carries TWO things, and both matter:
//
//   1. A spoken line, appended to the very END of the system prompt — after COMPANY
//      IDENTITY and every KB doc (see buildGuardianSystem's layout) — under a header
//      saying it outranks them. This is what lets Amber EXPLAIN a limit instead of just
//      refusing, and it is the whole mechanism for free-text notes.
//
//   2. For the structured kinds, the numbers her TOOLS resolve against. Without this a
//      note is only words: app/api/voice/availability would still compute an opening
//      from `max_per_day` and hand her a sentence telling her to book it, and the
//      transfer TwiML would still ring the person who is out. See the migration header
//      (supabase/2026-08-24_voice_receptionist_notes.sql) for why that conflict is real
//      rather than theoretical.
//
// Everything here is pure resolution — no writes. The admin write path (which generates
// each note's `body` from its fields, so call time never has to look up a name) lives in
// app/api/hub/voice-notes.

import type { SupabaseClient } from '@supabase/supabase-js'
import { SCHEDULING_TZ } from '@/lib/voice-scheduling'
import { toE164 } from '@/lib/phone'

export type VoiceNoteKind = 'text' | 'booking_cap' | 'coverage'

export type VoiceNoteRow = {
  id: string
  company_id: string
  kind: VoiceNoteKind
  body: string
  cap_date: string | null
  cap_service: string | null
  cap_max_jobs: number | null
  out_user_id: string | null
  cover_user_id: string | null
  starts_at: string
  expires_at: string | null
  cancelled_at: string | null
  created_by: string | null
  created_at: string
}

export const VOICE_NOTE_COLUMNS =
  'id, company_id, kind, body, cap_date, cap_service, cap_max_jobs, out_user_id, cover_user_id, starts_at, expires_at, cancelled_at, created_by, created_at'

/**
 * Every note in force for this company right now: started, not expired, not cancelled.
 *
 * Failure is deliberately NON-FATAL at every call site — a notes-table hiccup must not
 * take the receptionist off the air. Callers treat an empty list as "no overrides",
 * which is exactly the pre-feature behaviour.
 */
export async function getActiveVoiceNotes(
  admin: SupabaseClient,
  companyId: string,
  now: Date = new Date(),
): Promise<VoiceNoteRow[]> {
  const nowIso = now.toISOString()
  try {
    const { data, error } = await admin
      .from('voice_receptionist_notes')
      .select(VOICE_NOTE_COLUMNS)
      .eq('company_id', companyId)
      .is('cancelled_at', null)
      .lte('starts_at', nowIso)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('created_at', { ascending: true })
    if (error) {
      console.warn('[voice-notes] load failed', error.message)
      return []
    }
    return (data as VoiceNoteRow[] | null) ?? []
  } catch (err) {
    // A thrown network error here would otherwise reject the whole brain fetch and take
    // the receptionist off the air over an optional feature. Absent notes = the exact
    // behaviour that shipped before this existed, which is the right thing to fall to.
    console.warn('[voice-notes] load threw', (err as Error).message)
    return []
  }
}

// ---------------------------------------------------------------------------
// The prompt block
// ---------------------------------------------------------------------------

/** "6:00 PM today" / "Monday" / "Aug 31, 6:00 PM" — how long a note stands, in the
 *  company's timezone, phrased for a reader rather than a log. */
function expiryPhrase(expiresAt: string | null, now: Date): string {
  if (!expiresAt) return 'until further notice'
  const end = new Date(expiresAt)
  if (Number.isNaN(end.getTime())) return 'until further notice'

  const ymd = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: SCHEDULING_TZ }).format(d)
  const time = (d: Date) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: SCHEDULING_TZ,
      hour: 'numeric',
      minute: '2-digit',
    }).format(d)

  const endYmd = ymd(end)
  const todayYmd = ymd(now)
  if (endYmd === todayYmd) return `through ${time(end)} today`

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  if (endYmd === ymd(tomorrow)) return `through ${time(end)} tomorrow`

  const dateLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULING_TZ,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(end)
  return `through ${dateLabel}`
}

/**
 * Render the live notes as the prompt's final section.
 *
 * Returns '' when there are none, so the caller can drop it from the prompt entirely
 * rather than injecting an empty "no special instructions" heading (which reads to the
 * model as a fact worth mentioning).
 *
 * ⚠ The "do not read this aloud" line is load-bearing. Without it she recites the list
 * to callers — including the expiry timestamps — which sounds like a bot reading its
 * configuration out loud.
 */
export function buildNotesBlock(notes: VoiceNoteRow[], now: Date = new Date()): string {
  if (notes.length === 0) return ''
  const lines = notes.map((n) => {
    const body = (n.body || '').trim()
    if (!body) return null
    return `- ${body} (${expiryPhrase(n.expires_at, now)})`
  })
  const rendered = lines.filter(Boolean).join('\n')
  if (!rendered) return ''

  return `TODAY'S INSTRUCTIONS FROM THE OFFICE
These are current instructions from management, and they OUTRANK the company knowledge and the standing instructions above. Wherever anything conflicts, follow these.
Do not read this list aloud, quote it, or tell the caller you "were instructed" — just act on it, and if a caller asks, explain it naturally in your own words.

${rendered}`
}

// ---------------------------------------------------------------------------
// booking_cap — the numbers app/api/voice/availability resolves against
// ---------------------------------------------------------------------------

/**
 * Per-day booking caps for one service, as { 'YYYY-MM-DD': maxJobs }.
 *
 * PRECEDENCE — a service-specific cap beats an all-services cap on the same day, and
 * among equally-specific caps the most recently created one wins.
 *
 * That is deliberately NOT "most restrictive wins". The real sequence is: Ben says
 * "we're booked today, don't book anything" (all services -> 0), then an hour later
 * "actually you can take 2 more irrigation calls today" (Irrigation -> 2). Under a
 * min() rule the second note would silently do nothing — he would have typed a
 * correction that the system quietly discarded. Specific-beats-general is how the
 * sentence reads to a person, so it is how it resolves here.
 */
export function bookingCapsForService(
  notes: VoiceNoteRow[],
  serviceLineItem: string,
): Record<string, number> {
  const svc = (serviceLineItem || '').trim().toLowerCase()
  // Track how specific the winning note for each day was, so a later general note
  // cannot overwrite an earlier specific one.
  const out: Record<string, number> = {}
  const wonBySpecific: Record<string, boolean> = {}

  for (const n of notes) {
    if (n.kind !== 'booking_cap') continue
    if (!n.cap_date || n.cap_max_jobs === null || n.cap_max_jobs === undefined) continue

    const capSvc = (n.cap_service || '').trim().toLowerCase()
    const isSpecific = capSvc.length > 0
    if (isSpecific && capSvc !== svc) continue // a cap for a different service

    if (wonBySpecific[n.cap_date] && !isSpecific) continue // general can't beat specific
    out[n.cap_date] = n.cap_max_jobs
    if (isSpecific) wonBySpecific[n.cap_date] = true
  }
  return out
}

/**
 * True when EVERY schedulable service is capped at 0 for `ymd` by an all-services note.
 * Used to tell Amber to stop offering to book at all on that day rather than quoting a
 * date further out.
 */
export function isDayFullyBlocked(notes: VoiceNoteRow[], ymd: string): boolean {
  return notes.some(
    (n) =>
      n.kind === 'booking_cap' &&
      n.cap_date === ymd &&
      !((n.cap_service || '').trim()) &&
      n.cap_max_jobs === 0,
  )
}

// ---------------------------------------------------------------------------
// coverage — who actually gets rung
// ---------------------------------------------------------------------------

/** { userWhoIsOut -> userCoveringForThem }. Later notes win for the same person. */
export function coverageMap(notes: VoiceNoteRow[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const n of notes) {
    if (n.kind !== 'coverage') continue
    if (!n.out_user_id || !n.cover_user_id) continue
    map[n.out_user_id] = n.cover_user_id
  }
  return map
}

/**
 * Re-point a list of transfer recipients through the coverage map, preserving order and
 * dropping duplicates (the cover person may already be on the list).
 *
 * Single-hop ONLY. If Kathryn is covered by Ben and Ben is covered by Sam, Kathryn's
 * calls go to Ben, not Sam. Chasing the chain would be a nicer story right up until two
 * notes point at each other and the resolver spins; a one-hop rule cannot loop, and the
 * two-hop case is rare enough to be worth losing.
 */
export function applyCoverageToUserIds(
  userIds: string[],
  map: Record<string, string>,
): string[] {
  if (Object.keys(map).length === 0) return userIds
  const out: string[] = []
  for (const id of userIds) {
    const resolved = map[id] ?? id
    if (!out.includes(resolved)) out.push(resolved)
  }
  return out
}

/**
 * Resolve a company's transfer recipients through any active coverage notes.
 *
 * ⚠ WHY THIS IS NOT DONE INSIDE getEffectiveVoiceReceptionistSettings, which would be
 * the obvious single choke point: that loader also feeds the ADMIN screen
 * (app/api/admin/voice-receptionist-settings). Applying coverage there would show Ben a
 * transfer list that isn't the one he saved, and — because the admin panel POSTs back
 * what it rendered — a save while someone was out would quietly make the temporary
 * override permanent. So coverage is applied at the CALL-TIME transfer points only, and
 * the stored setting is never touched.
 *
 * ⚠ THE CELL METHOD NEEDS A NUMBER FOR THE PERSON WHO STEPS IN. `transferCellNumbers`
 * only holds entries for users an admin put on the transfer list, so re-pointing
 * Kathryn's calls to Ben would hand back a Ben with no number, who is then filtered out
 * as unreachable — the transfer would silently become "unavailable" rather than ringing
 * anybody. Their profile phone is looked up to fill that gap.
 */
export async function applyCoverageToTransfer(
  admin: SupabaseClient,
  companyId: string,
  settings: { transferUserIds: string[]; transferCellNumbers: Record<string, string> },
  preloadedNotes?: VoiceNoteRow[],
): Promise<{ transferUserIds: string[]; transferCellNumbers: Record<string, string> }> {
  const notes = preloadedNotes ?? (await getActiveVoiceNotes(admin, companyId).catch(() => []))
  const map = coverageMap(notes)
  if (Object.keys(map).length === 0) return settings

  const transferUserIds = applyCoverageToUserIds(settings.transferUserIds, map)
  const transferCellNumbers = { ...settings.transferCellNumbers }

  const missing = transferUserIds.filter((id) => !transferCellNumbers[id])
  if (missing.length > 0) {
    try {
      const { data } = await admin
        .from('user_profiles')
        .select('id, phone')
        .in('id', missing)
      for (const row of (data as { id: string; phone: string | null }[] | null) ?? []) {
        const e164 = row.phone ? toE164(row.phone) : null
        if (e164) transferCellNumbers[row.id] = e164
      }
    } catch (err) {
      console.warn('[voice-notes] coverage cell lookup failed', (err as Error).message)
      // Non-fatal — a cover person with no reachable number is filtered out downstream
      // exactly as an unconfigured recipient always was.
    }
  }

  return { transferUserIds, transferCellNumbers }
}

/**
 * Re-point Level 5 routing-directory destinations through the coverage map.
 *
 * Only `dest_kind === 'user'` entries move: a ring group, extension, or cell number is
 * a destination in its own right, not a person, and re-pointing "Billing" to somebody's
 * softphone because they happen to cover for one person would be wrong.
 */
export function applyCoverageToRoutingEntries<
  T extends { dest_kind: string; dest_value: string },
>(entries: T[], map: Record<string, string>): T[] {
  if (Object.keys(map).length === 0) return entries
  return entries.map((e) =>
    e.dest_kind === 'user' && map[e.dest_value]
      ? { ...e, dest_value: map[e.dest_value] }
      : e,
  )
}

// ---------------------------------------------------------------------------
// Expiry helpers — "end of that day, where the company is"
// ---------------------------------------------------------------------------

/** How far the given instant's local time in `tz` sits from UTC, in ms. */
function tzOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value
      return acc
    }, {})
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24, // hour12:false yields "24" for midnight in some engines
    Number(parts.minute),
    Number(parts.second),
  )
  // ⚠ Compare against the instant truncated to whole SECONDS. Intl formats to second
  // precision, so `asUtc` carries no milliseconds; subtracting a millisecond-bearing
  // instant folds those milliseconds into the "offset" and skews every result by up to
  // 999ms. That is not academic: end-of-day came back as 12:00:00.997 AM the NEXT day,
  // so a note set to expire tonight rendered on the card as "through tomorrow".
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/**
 * The last instant of `ymd` in the company's timezone, as a UTC Date.
 *
 * Done by offset correction rather than by assuming a fixed -05:00/-06:00, so a note
 * set for a DST changeover day expires at the right moment instead of an hour early or
 * late. The offset is resolved twice because the first probe can land on the wrong side
 * of the transition.
 */
export function endOfDayInCompanyTz(ymd: string, tz: string = SCHEDULING_TZ): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  const naive = Date.UTC(y, m - 1, d, 23, 59, 59, 999)
  let utc = naive - tzOffsetMs(new Date(naive), tz)
  utc = naive - tzOffsetMs(new Date(utc), tz)
  return new Date(utc)
}

/** Today's date in the company's timezone, as YYYY-MM-DD. */
export function todayInCompanyTz(tz: string = SCHEDULING_TZ, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)
}
