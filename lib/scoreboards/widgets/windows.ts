/* Date windows for Scoreboards.
 *
 * Today's boards hardcode their window at the CALL SITE (year-to-date, trailing
 * six weeks, trailing four months) even though the underlying RPCs already take
 * (p_start, p_end, p_bucket). Making the window a parameter is therefore mostly
 * plumbing — see REPORTS_PRD.md §9.1.4a for the per-source audit.
 *
 * All arithmetic is done in America/Chicago (the business's clock), because
 * "year to date" on Jan 1 must not be last year just because the server is UTC.
 */

import type { WindowSpec } from './types'

const TZ = 'America/Chicago'
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type RangeKey =
  | 'ytd' | 'this_month' | 'last_month' | 'this_quarter' | 'last_12' | 'last_year' | 'custom'

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'ytd', label: 'Year to date' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'This quarter' },
  { key: 'last_12', label: 'Last 12 months' },
  { key: 'last_year', label: 'Last year' },
  { key: 'custom', label: 'Custom range…' },
]

/** Earliest date worth accepting — the recurring book starts in 2025. */
const FLOOR = '2015-01-01'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date in YYYY-MM-DD, or null. Rejects 2026-02-31 and friends. */
function parseDate(v: string | null | undefined): string | null {
  if (!v || !DATE_RE.test(v)) return null
  const [y, m, d] = v.split('-').map(Number)
  if (m < 1 || m > 12) return null
  if (d < 1 || d > lastDayOfMonth(y, m)) return null
  return v
}

function todayInBusinessTz(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? '0')
  return { y: get('year'), m: get('month'), d: get('day') }
}

/**
 * Today on the business's clock, YYYY-MM-DD.
 *
 * Exported so the ONE definition of "today" is shared: the narrating widget has to
 * know whether the last month on a chart is finished before it may call a fall a
 * fall, and a second copy of this that drifted to UTC would get that wrong for six
 * hours a day.
 */
export function businessToday(): string {
  const t = todayInBusinessTz()
  return ymd(t.y, t.m, t.d)
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
function shiftMonth(y: number, m: number, by: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + by
  return { y: Math.floor(total / 12), m: (total % 12) + 1 }
}

function pretty(start: string, end: string): string {
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const left = `${MONTH_ABBR[sm - 1]} ${sd}`
  const right = `${MONTH_ABBR[em - 1]} ${ed}`
  if (sy === ey) {
    if (start === end) return `${left}, ${ey}`                       // a single day
    if (sm === em && sd === 1 && ed === lastDayOfMonth(ey, em)) return `${MONTH_ABBR[em - 1]} ${ey}`
    return `${left} – ${right}, ${ey}`
  }
  return `${left}, ${sy} – ${right}, ${ey}`
}

/**
 * Resolve a named range against the business clock. Unknown keys fall back to YTD.
 *
 * `custom` needs both dates and takes them verbatim; anything invalid falls back
 * to YTD rather than erroring, because a bad date in a URL should show a sensible
 * board, not a broken one. Reversed dates are swapped rather than rejected — the
 * user's intent is obvious and refusing it would be pedantic.
 */
export function resolveWindow(
  range: string | null | undefined,
  customStart?: string | null,
  customEnd?: string | null,
): WindowSpec {
  const t = todayInBusinessTz()
  const today = ymd(t.y, t.m, t.d)

  if (range === 'custom') {
    let a = parseDate(customStart)
    let b = parseDate(customEnd)
    if (a && b) {
      if (a > b) [a, b] = [b, a]
      if (a < FLOOR) a = FLOOR
      // Allow an end date in the future (a range through year-end is a fair ask);
      // it simply has no data past today.
      return { start: a, end: b, label: pretty(a, b), phrase: `${pretty(a, b)}` }
    }
    // Incomplete custom range — behave as YTD until both dates are set.
  }

  switch (range) {
    case 'this_month': {
      const start = ymd(t.y, t.m, 1)
      return { start, end: today, label: pretty(start, today), phrase: `${MONTH_ABBR[t.m - 1]} so far` }
    }
    case 'last_month': {
      const p = shiftMonth(t.y, t.m, -1)
      const start = ymd(p.y, p.m, 1)
      const end = ymd(p.y, p.m, lastDayOfMonth(p.y, p.m))
      return { start, end, label: pretty(start, end), phrase: `${MONTH_ABBR[p.m - 1]} ${p.y}` }
    }
    case 'this_quarter': {
      const qStartMonth = Math.floor((t.m - 1) / 3) * 3 + 1
      const start = ymd(t.y, qStartMonth, 1)
      return { start, end: today, label: pretty(start, today), phrase: `Q${Math.floor((t.m - 1) / 3) + 1} ${t.y}` }
    }
    case 'last_12': {
      const p = shiftMonth(t.y, t.m, -11)
      const start = ymd(p.y, p.m, 1)
      return { start, end: today, label: pretty(start, today), phrase: 'the last 12 months' }
    }
    case 'last_year': {
      const y = t.y - 1
      const start = ymd(y, 1, 1)
      const end = ymd(y, 12, 31)
      return { start, end, label: `Jan 1 – Dec 31, ${y}`, phrase: String(y) }
    }
    case 'ytd':
    default: {
      const start = ymd(t.y, 1, 1)
      return { start, end: today, label: pretty(start, today), phrase: `${t.y} YTD` }
    }
  }
}

/**
 * The window of the same length immediately before this one — what "vs last"
 * compares against on the Home tiles.
 *
 * Equal-length rather than "the previous calendar month", so a custom range gets a
 * fair comparison too: an 11-day window is compared with the 11 days before it.
 *
 * ⚠ This says nothing about whether the prior window has DATA. A comparison
 * reaching back before the invoice mirror's floor reads as a collapse rather than
 * an absence, so every caller checks the floor and drops the delta instead of
 * printing a −100%.
 */
export function priorWindow(win: WindowSpec): WindowSpec {
  const startMs = Date.parse(`${win.start}T00:00:00Z`)
  const endMs = Date.parse(`${win.end}T00:00:00Z`)
  const DAY = 86_400_000
  const lenDays = Math.max(1, Math.round((endMs - startMs) / DAY) + 1)
  const prevEnd = new Date(startMs - DAY)
  const prevStart = new Date(startMs - lenDays * DAY)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const start = iso(prevStart)
  const end = iso(prevEnd)
  return { start, end, label: pretty(start, end), phrase: pretty(start, end) }
}

/** The calendar year a window belongs to — its END year, so a Q1 window reads as this year. */
export function windowYear(win: WindowSpec): number {
  return Number(win.end.slice(0, 4))
}

/** This year on the business's clock. Year-based metrics need it to say whether a
 *  year is finished ("2025 full year") or still running ("2026 to date"). */
export function currentBusinessYear(): number {
  return todayInBusinessTz().y
}
