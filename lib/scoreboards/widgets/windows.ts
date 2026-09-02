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
 * The window a URL is asking for, when that URL may name a range, or give two dates,
 * or both.
 *
 * ⚠⚠ THIS EXISTS FOR ONE CASE: TWO DATES AND NO RANGE. `resolveWindow` honours
 * `customStart`/`customEnd` only under `range === 'custom'`, which is exactly right
 * for a picker — but every drill-down link in the widget library is built as
 * `?start=…&end=…` with no range at all (five `drillTo` helpers, ten call sites, plus
 * the commission link). So the dates were parsed, discarded, and replaced by the
 * report's own default range: a card showing one month opened a year-to-date list,
 * and the Excel download alongside it contained the same wrong slice. Ben's report of
 * it was "it has everything YTD and not sorted in any logical order".
 *
 * Inferring `custom` from a COMPLETE pair of dates is what every one of those links
 * already means. Fixed here, in the one place both readers share, rather than in six
 * link builders where the next one written would reintroduce it.
 *
 * ⚠ The resolved key is returned as well as the window, because a page that received
 * bare dates has to pass `range=custom` onward — its own "back to the report" link and
 * its Excel export are parsed by the same rule, and dropping the key there would land
 * the user back on the default window they had just navigated away from.
 */
export function windowFromParams(
  range: string | null | undefined,
  start: string | null | undefined,
  end: string | null | undefined,
  /** What to use when the URL names nothing and gives no dates. Optional, because a
   *  report may declare no default of its own; `resolveWindow` treats an absent key as
   *  year-to-date, which is the same answer this used to give by accident. */
  fallback?: string | null,
): { win: WindowSpec; range: string } {
  // Both dates must be real. A half-given pair is not a custom range, and treating it
  // as one would silently swap the whole period for a YTD fallback under a `custom`
  // label — a window whose name and contents disagree.
  const bothGiven = !!(parseDate(start) && parseDate(end))
  const key = range || (bothGiven ? 'custom' : fallback) || 'ytd'
  return { win: resolveWindow(key, start, end), range: key }
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

/* ── Commission weeks ─────────────────────────────────────────────────────────
 *
 * Ben's bonus weeks are Monday-anchored and grouped into months, but a Mon–Sun week
 * straddles the 1st twice a quarter, so the rule that matters is WHICH MONTH OWNS A
 * SPLIT WEEK. Ben's answer: "if more days of the week are in month 1, then it should
 * belong to month 1. If more days are in month 2, it should be in month 2."
 *
 * ⚠⚠ THAT RULE HAS A CLOSED FORM AND CAN NEVER TIE. A week is SEVEN days — an odd
 * number — so one month always holds at least four of them, and because the days are
 * contiguous the majority month is always the one holding the week's FOURTH day: its
 * THURSDAY. So:
 *
 *     A bonus week belongs to the month containing its Thursday.
 *
 * This is not a house invention — it is exactly how ISO 8601 assigns a week to a year,
 * for the same reason. Implemented as the Thursday test rather than by counting days,
 * because the two are provably identical and this one cannot be got wrong.
 *
 * ⚠⚠ IT TILES PERFECTLY, WHICH IS THE WHOLE POINT AND WAS THE BUG BEFORE. Every week
 * lands in exactly one month, so every day of the year is in exactly one bonus month:
 * no gaps and no overlaps. The previous rule ("W1 = last Monday on or before the 1st,
 * then exactly four weeks") left real weeks in NO bonus month at all — Aug 24–30 and
 * Nov 23–29 in 2026, four months a year, with thousands of dollars of completed work
 * in them. A month now has FOUR OR FIVE bonus weeks, and 2026 runs
 * 5,4,4,5,4,4,5,4,4,5,4,5 — 52 weeks, all accounted for.
 *
 * ⚠ Defined here ONCE and passed to the RPC as buckets, so there is exactly one place
 * that can be wrong about which days a bonus week covers. `scoreboard_commission_
 * production` counts whatever buckets it is handed and needed no change to go from
 * four to five.
 */

export type CommissionWeek = {
  /** 1-based within its month. Runs to 4 or 5 — never assume 4. */
  n: number
  start: string
  end: string
  /** "W2 Aug 3 – Aug 9" — for a card's own row labels. */
  label: string
}

/** 0 = Monday … 6 = Sunday. Calendar dates only, so UTC is safe. */
function dowMonday0(y: number, m: number, d: number): number {
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun..6=Sat
  return (js + 6) % 7
}

function addDaysYmd(ymdStr: string, n: number): string {
  const [y, m, d] = ymdStr.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/** The day-of-month of the first Thursday of this month (1-7). */
function firstThursday(year: number, month: number): number {
  // Monday=0 … Thursday=3. Days to add to the 1st to reach the first Thursday.
  const dow = dowMonday0(year, month, 1)
  return 1 + ((3 - dow + 7) % 7)
}

/**
 * Every bonus week of one commission month — the weeks whose THURSDAY falls in it.
 *
 * ⚠ Four or five, decided by how many Thursdays the month has. Never hardcode 4.
 */
export function commissionWeeks(year: number, month: number): CommissionWeek[] {
  const firstThu = firstThursday(year, month)
  const days = lastDayOfMonth(year, month)
  const out: CommissionWeek[] = []
  for (let thu = firstThu, n = 1; thu <= days; thu += 7, n++) {
    // The week's Monday is three days before its Thursday.
    const start = addDaysYmd(ymd(year, month, thu), -3)
    const end = addDaysYmd(start, 6)
    out.push({ n, start, end, label: `W${n} ${pretty(start, end).replace(/, \d{4}$/, '')}` })
  }
  return out
}

/** W1's first day — the Monday of the week holding this month's first Thursday. */
export function commissionMonthStart(year: number, month: number): string {
  return addDaysYmd(ymd(year, month, firstThursday(year, month)), -3)
}

export type CommissionMonth = {
  year: number
  month: number
  /** Four or five weeks — read `weeks.length`, never assume. */
  weeks: CommissionWeek[]
  /** W1's first day. */
  start: string
  /** The last week's last day. */
  end: string
}

/**
 * The commission month a window belongs to, with its bonus weeks.
 *
 * ⚠ Keyed on the window's END month, matching `windowYear`: a board showing "August"
 * asks for Aug 1–31, and under the Thursday rule August's own W1 starts Aug 3 — but a
 * window ending mid-month still belongs to the month it ends in. Using the START month
 * would read a one-month window as the previous month's bonus period.
 */
export function commissionMonth(win: WindowSpec): CommissionMonth {
  const year = Number(win.end.slice(0, 4))
  const month = Number(win.end.slice(5, 7))
  const weeks = commissionWeeks(year, month)
  return {
    year,
    month,
    weeks,
    start: weeks[0].start,
    end: weeks[weeks.length - 1].end,
  }
}

/** "Aug 3 – Aug 30" — the month's bonus weeks as one phrase. */
export function commissionMonthLabel(cm: CommissionMonth): string {
  return pretty(cm.start, cm.end)
}

/**
 * The buckets a commission rule is measured over, serialised for the RPC.
 *
 * ⚠ `SourceParams` only carries scalars — that is what keeps the resolver's dedupe key
 * a plain string — so the weeks travel joined, exactly as `lead_items` joins its
 * stages. Parsed back apart in SQL, which counts however many it is given.
 */
export function encodeBuckets(weeks: CommissionWeek[]): string {
  return weeks.map(w => `W${w.n}:${w.start}:${w.end}`).join(',')
}
