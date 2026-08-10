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

export type RangeKey = 'ytd' | 'this_month' | 'last_month' | 'this_quarter' | 'last_12' | 'last_year'

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'ytd', label: 'Year to date' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'This quarter' },
  { key: 'last_12', label: 'Last 12 months' },
  { key: 'last_year', label: 'Last year' },
]

function todayInBusinessTz(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? '0')
  return { y: get('year'), m: get('month'), d: get('day') }
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
    if (sm === em && sd === 1 && ed === lastDayOfMonth(ey, em)) return `${MONTH_ABBR[em - 1]} ${ey}`
    return `${left} – ${right}, ${ey}`
  }
  return `${left}, ${sy} – ${right}, ${ey}`
}

/** Resolve a named range against the business clock. Unknown keys fall back to YTD. */
export function resolveWindow(range: string | null | undefined): WindowSpec {
  const t = todayInBusinessTz()
  const today = ymd(t.y, t.m, t.d)

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

/** The calendar year a window belongs to — its END year, so a Q1 window reads as this year. */
export function windowYear(win: WindowSpec): number {
  return Number(win.end.slice(0, 4))
}
