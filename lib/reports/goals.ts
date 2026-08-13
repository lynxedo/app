/* The metric catalog for Goals & Targets (REPORTS_PRD §8.11).
 *
 * One entry per thing you can set a target on. A metric is here ONLY if
 * `scoreboard_goals` can compute its actual for an arbitrary period from a
 * report function that already owns that number — so a goal can never disagree
 * with the report it is judged against.
 *
 * ⚠⚠ `cumulative` is the important field, not the label.
 *
 * Pace — "you should be at X by now" — only means anything for something that
 * accumulates. Invoiced, collected and leads pile up through a period, so being
 * 40% through the month with 40% of the target is on track. A close RATE does
 * not work that way: 40% through the month does not mean you should have 40% of
 * your close rate. Prorating a rate target would produce confident nonsense, so
 * rate metrics get attainment and no pace at all, and the card says why.
 */

export type GoalMetric = {
  key: string
  label: string
  /** How the target and actual are rendered. */
  format: 'currency' | 'number' | 'percent'
  /** Accumulates through the period, so pace is meaningful. See the header. */
  cumulative: boolean
  /** What the number actually counts, for the target-setting screen. */
  help: string
}

export const GOAL_METRICS: GoalMetric[] = [
  {
    key: 'invoiced',
    label: 'Invoiced',
    format: 'currency',
    cumulative: true,
    help: 'Work billed in the period, excluding drafts. Matches the Revenue report.',
  },
  {
    key: 'collected',
    label: 'Cash collected',
    format: 'currency',
    cumulative: true,
    help: 'Payments received against invoices in the period.',
  },
  {
    key: 'new_customers',
    label: 'New customers',
    format: 'number',
    cumulative: true,
    help: 'Customers added in the period. Matches the Clients report.',
  },
  {
    key: 'leads',
    label: 'Leads',
    format: 'number',
    cumulative: true,
    help: 'Leads created in the period, the same cohort the close rate uses.',
  },
  {
    key: 'won_value',
    label: 'Value sold',
    format: 'currency',
    cumulative: true,
    help: 'Annual value of leads won in the period.',
  },
  {
    key: 'close_rate',
    label: 'Close rate',
    format: 'percent',
    cumulative: false,
    help: 'Share of decided leads won. A rate, so no pace is shown — see the report.',
  },
  {
    key: 'rev_per_labor_hour',
    label: 'Revenue per labour hour',
    format: 'currency',
    cumulative: false,
    help: 'Revenue divided by clocked hours. A rate, and clamped to where timeclock data exists.',
  },
]

export const GOAL_GRAINS = ['month', 'quarter', 'year'] as const
export type GoalGrain = (typeof GOAL_GRAINS)[number]

export function getGoalMetric(key: string): GoalMetric | null {
  return GOAL_METRICS.find(m => m.key === key) ?? null
}

/**
 * The period a grain + start date covers.
 *
 * Both ends are computed HERE and stored on the row, so the report and the
 * target-setting screen can never disagree about where a quarter ends.
 */
export function periodBounds(grain: GoalGrain, startISO: string): { start: string; end: string } {
  const [y, m] = startISO.split('-').map(Number)
  if (grain === 'year') return { start: `${y}-01-01`, end: `${y}-12-31` }
  if (grain === 'quarter') {
    const qStart = Math.floor((m - 1) / 3) * 3 + 1
    const qEnd = qStart + 2
    const last = new Date(Date.UTC(y, qEnd, 0)).getUTCDate()
    return { start: `${y}-${String(qStart).padStart(2, '0')}-01`, end: `${y}-${String(qEnd).padStart(2, '0')}-${last}` }
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${last}` }
}

/** How a period reads on a card: "August 2026", "Q3 2026", "2026". */
export function periodLabel(grain: GoalGrain, startISO: string): string {
  const [y, m] = startISO.split('-').map(Number)
  if (grain === 'year') return String(y)
  if (grain === 'quarter') return `Q${Math.floor((m - 1) / 3) + 1} ${y}`
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}
