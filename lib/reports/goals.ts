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
 *
 * ⚠⚠ `perPerson` is the second load-bearing field, and it is a statement about
 * the DATA rather than a product preference.
 *
 * A target can be set for one person only where that person's actual can be
 * computed honestly. Four can: leads, value sold and close rate all come from
 * `scoreboard_people.sales`, and revenue per labour hour from its `field` block
 * — both halves of that ratio belong to the person, which is why it works here
 * while the company-wide Crew ratios cannot be split at all (§9's person filter
 * found exactly the same asymmetry).
 *
 * Three cannot, and the reason is attribution, not effort:
 *   invoiced      — `invoices.salesperson_external_id` is set on roughly a third
 *                   of rows, so a person's billed total would omit most of it.
 *   collected     — a payment records no salesperson whatsoever.
 *   new_customers — the Clients report has no per-person breakdown, and deriving
 *                   one from leads would produce a different number than the
 *                   report shows, which is the one thing §8.11 exists to prevent.
 *
 * Offering those three per person would render "no data" forever, or worse, show
 * the COMPANY figure beside somebody's name. So the target screen hides them for
 * a person and the API refuses them.
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
  /** Can be set for ONE person, not only the company. See the header. */
  perPerson: boolean
  /**
   * Why this cannot be a person's target. Set only when `perPerson` is false and
   * shown in the UI — an option that is merely absent invites the next person to
   * file it as a bug and re-add it without the reason.
   */
  perPersonBlocker?: string
}

export const GOAL_METRICS: GoalMetric[] = [
  {
    key: 'invoiced',
    label: 'Invoiced',
    format: 'currency',
    cumulative: true,
    help: 'Work billed in the period, excluding drafts. Matches the Revenue report.',
    perPerson: false,
    perPersonBlocker: 'Invoices name a salesperson on only about a third of rows, so one person\u2019s billed total would leave most of it out.',
  },
  {
    key: 'collected',
    label: 'Cash collected',
    format: 'currency',
    cumulative: true,
    help: 'Payments received against invoices in the period.',
    perPerson: false,
    perPersonBlocker: 'A payment does not record who sold the work, so it cannot be credited to a person.',
  },
  {
    key: 'new_customers',
    label: 'New customers',
    format: 'number',
    cumulative: true,
    help: 'Customers added in the period. Matches the Clients report.',
    perPerson: false,
    perPersonBlocker: 'The Clients report does not break new customers down by person, and working one out separately would disagree with it.',
  },
  {
    key: 'leads',
    label: 'Leads',
    format: 'number',
    cumulative: true,
    help: 'Leads created in the period, the same cohort the close rate uses.',
    perPerson: true,
  },
  {
    key: 'won_value',
    label: 'Value sold',
    format: 'currency',
    cumulative: true,
    help: 'Annual value of leads won in the period.',
    perPerson: true,
  },
  {
    key: 'close_rate',
    label: 'Close rate',
    format: 'percent',
    cumulative: false,
    help: 'Share of decided leads won. A rate, so no pace is shown — see the report.',
    perPerson: true,
  },
  {
    key: 'rev_per_labor_hour',
    label: 'Revenue per labour hour',
    format: 'currency',
    cumulative: false,
    help: 'Revenue divided by clocked hours. A rate, and clamped to where timeclock data exists.',
    perPerson: true,
  },
]

export const GOAL_GRAINS = ['month', 'quarter', 'year'] as const
export type GoalGrain = (typeof GOAL_GRAINS)[number]

export function getGoalMetric(key: string): GoalMetric | null {
  return GOAL_METRICS.find(m => m.key === key) ?? null
}

/** The measures a single person can be given a target on. */
export const PER_PERSON_GOAL_METRICS = GOAL_METRICS.filter(m => m.perPerson)

/**
 * Whether this measure can be scoped to one person.
 *
 * ⚠ An unknown key answers false. A metric that has left the catalog must not
 * become settable for a person just because nothing recognises it any more.
 */
export function metricSupportsPerson(key: string): boolean {
  return getGoalMetric(key)?.perPerson === true
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
