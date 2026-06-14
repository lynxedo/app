// Central-time date helpers (Phase 5, TS4). Heroes operates in America/Chicago, but
// the timesheet write paths bucketed punches by UTC calendar date — so an evening
// shift after ~7pm Central (which is past UTC midnight) filed under the next day or
// got dropped. These helpers compute the *Central* calendar date for an instant and
// the UTC instant-bounds for a Central calendar day, DST-aware, with no date library.

export const CENTRAL_TZ = 'America/Chicago'

/** The YYYY-MM-DD calendar date that an instant falls on in Central time. */
export function centralDate(instant: Date | string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CENTRAL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** Minutes that Central is offset from UTC at a given instant (negative; -300 in CDT, -360 in CST). */
function centralOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const m: Record<string, string> = {}
  for (const p of parts) m[p.type] = p.value
  const asIfUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second)
  return (asIfUtc - at.getTime()) / 60000
}

/** The UTC instant of Central midnight (00:00:00) on a Central calendar date. */
function centralMidnightUtc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  const offset = centralOffsetMinutes(guess)
  let t = guess.getTime() - offset * 60000
  // Re-check once in case the naive guess landed on the other side of a DST switch.
  const offset2 = centralOffsetMinutes(new Date(t))
  if (offset2 !== offset) t = guess.getTime() - offset2 * 60000
  return new Date(t)
}

/**
 * UTC instant bounds for a Central calendar day: [startIso, endIso). Use as
 *   .gte('punched_at', startIso).lt('punched_at', endIso)
 * so a punch is bucketed to the Central day it actually happened on.
 */
export function centralDayRangeUtc(date: string): { startIso: string; endIso: string } {
  const start = centralMidnightUtc(date)
  // The next Central calendar date (handles month/year rollover via UTC math).
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  const nextDate = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
  const end = centralMidnightUtc(nextDate)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}
