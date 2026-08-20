/* The metric catalog for Goals & Targets (REPORTS_PRD §8.11).
 *
 * One entry per thing you can set a target on. A metric is here ONLY if
 * `scoreboard_goals` can compute its actual for an arbitrary period from a
 * report function that already owns that number — so a goal can never disagree
 * with the report it is judged against.
 *
 * ⚠⚠ ADDING A METRIC HERE IS HALF THE JOB. The actual is computed in the
 * `scoreboard_goals` database function, which is the only place that can read
 * the report sources. A key listed here but absent from that function's metric
 * properties block reads "No data" on the report — deliberately loud, rather
 * than being judged by whatever the defaults happen to be.
 *
 * ── The four fields that decide whether a verdict is honest ─────────────────
 *
 * ⚠⚠ `cumulative` — pace, "you should be at X by now", only means anything for
 * something that piles up through a period. Invoiced, collected and leads do, so
 * being 40% through the month with 40% of the target is on track. A close RATE
 * does not: 40% through the month does not mean 40% of your close rate.
 * Prorating a rate would produce confident nonsense, so rate metrics get
 * attainment and no pace at all, and the card says why.
 *
 * ⚠⚠ `direction` — every metric here used to be higher-is-better, and the status
 * logic simply assumed it. Labour cost %, missed calls and reply time are the
 * opposite: hitting a 22% labour target means coming in AT OR BELOW it. Without
 * this field a cost overrun would be reported as an achievement, which is the
 * worst way for a target to be wrong. Attainment is inverted for these too
 * (target ÷ actual), so 23.8% against a 22% target reads 92%, not 108%.
 *
 * ⚠⚠ `judge` — retention and churn can only be read as a year-to-date share of
 * the whole year's book, so they start near-perfect in January and only worsen.
 * Scored the normal way, an annual retention target would read "Hit" from the
 * first week and only turn red in December. `judge: 'period_end'` shows the
 * running figure but withholds the verdict until the period is over.
 *
 * Collection rate is deferred for the same reason, found by rendering a real
 * August payload: month-to-date it read 91.4% against a 95% target while July
 * finished at 99.98%. ⚠ Quote win rate deliberately keeps the running verdict
 * despite a milder version of the bias (a quote sent yesterday is still open),
 * because close rate has always behaved that way and making its twin behave
 * differently would be a surprise rather than a fix.
 *
 * ⚠ `grains` — retention and churn come from a function that takes a YEAR, not a
 * date range, so a monthly retention target is not a smaller version of the same
 * question. Those metrics accept year targets only, and both the screen and the
 * API say so rather than storing a target nothing can measure.
 *
 * ── Which DATE a sale belongs to ───────────────────────────────────────────
 *
 * ⚠⚠ The five "how much did you sell" measures — value sold (all / new business /
 * upsells), deals won and average deal size — count a deal in the period it was
 * SOLD, not the period its lead arrived. Ben, asked directly: "we want close date
 * not lead creation date." A lead that came in during July and closed in August is
 * August's work, and this is the same rule the commission bases use, so a sales
 * target and the bonus paid on it cannot disagree.
 *
 * ⚠ `leads` and `close_rate` KEEP the arrival cohort, and that is not an oversight.
 * A lead count is a question about arrivals by definition; and a close rate measured
 * over the deals that closed would read 100% by construction, because there the
 * cohort IS the denominator. The Sales report keeps the arrival cohort throughout for
 * the same reason, which is why a target and that report can show different totals
 * for one month and both be right.
 *
 * ── The timeclock clamp: safe for rates, unsafe for totals ──────────────────
 *
 * ⚠⚠ `scoreboard_crew_labor` and `scoreboard_service_lines` CLAMP their window
 * to the days timeclock data exists for, because they divide revenue by clocked
 * hours and half a ratio would be a lie. That clamp is safe for a RATE — both
 * halves move together — and unsafe for a TOTAL, where it silently shortens the
 * period and the target reads behind for a reason that has nothing to do with
 * the work. So:
 *   • rates from Crew (`labor_pct`, `rev_per_visit`, `rev_per_labor_hour`) read
 *     that source, and their help text names the clamp.
 *   • `visit_revenue`, a cumulative total, reads `scoreboard_visit_revenue`,
 *     which does not clamp. The two agree to the cent on today's data — the
 *     unclamped source is protection, not a different number.
 * The same rule is why there is no "revenue after labour" target: it is a
 * cumulative total that can only be built from the clamped source.
 *
 * ── Considered and deliberately absent ─────────────────────────────────────
 *
 *   recurring book value / size — `scoreboard_recurring_book` takes no dates at
 *     all; it is what is on the books RIGHT NOW. A "grow the book to $400k"
 *     target would be judged against today's book whatever period was picked, so
 *     a finished year would be scored on a number from after it ended. Honest
 *     version needs a monthly book snapshot to measure against; worth building.
 *   visits completed — the only visit COUNT the reports expose comes from the
 *     clamped Crew source, so a throughput target would read low whenever the
 *     timeclock lags. See the clamp rule above.
 *   revenue after labour — same reason: a cumulative total off a clamped source.
 *   cost per lead / marketing spend — no ad spend is held anywhere.
 *   anything per-person from calls or texts — `scoreboard_people` has no comms
 *     block, so a person's answer rate or reply time cannot be computed. (The
 *     People report refuses a personal answer rate for a deeper reason: the
 *     `handled_by` stamp is written before a call is offered to anyone.)
 *
 * ── Why only some measures can belong to one person ────────────────────────
 *
 * ⚠⚠ `perPerson` is a statement about the DATA rather than a product preference.
 * A target can be set for one person only where that person's actual can be
 * computed honestly — which means it comes out of `scoreboard_people`, the same
 * composer the People report and commission are built on.
 *
 * Ten can: leads, deals won, value sold, new-business value, upsell value,
 * average deal and close rate all come from that source's `sales` block, and work
 * produced, revenue per hour and labour cost % from its `field` block — where BOTH
 * HALVES of the ratio belong to the person, which is the whole test. A ratio passes
 * it or it does not: revenue per visit fails, because the visit COUNT behind it is
 * never fanned out, and no amount of filtering the other half fixes that (§9's
 * person filter found exactly the same asymmetry).
 *
 * ⚠ Labour cost % joined this list on Aug 20 2026 and is the reason the test is
 * worth restating. It had been refused on the grounds that it "divides wages by
 * COMPANY revenue" — true of the company calculation, and true of nothing else.
 * Each person's pay and each person's credited revenue had been sitting side by
 * side in `scoreboard_crew_labor` the whole time; `scoreboard_people` simply did
 * not carry the pay half through. The lesson is that "cannot be split" and "is not
 * currently carried across" look identical from the metric catalog, and only the
 * first is a reason to refuse.
 *
 * The rest cannot, and the reason is attribution, not effort:
 *   invoiced      — `invoices.salesperson_external_id` is set on roughly a third
 *                   of rows, so a person's billed total would omit most of it.
 *   collected     — a payment records no salesperson whatsoever.
 *   new_customers — the Clients report has no per-person breakdown, and deriving
 *                   one from leads would produce a different number than the
 *                   report shows, which is the one thing §8.11 exists to prevent.
 *   quotes        — the Quotes source breaks down by salesperson, but that name
 *                   is not carried into `scoreboard_people`, so a person's quote
 *                   figure would come from a different composer than every other
 *                   personal number on the report.
 *   rev_per_visit — its denominator is a visit COUNT, which the Crew source only
 *                   ever states company-wide. The one Crew rate that genuinely
 *                   cannot be split, now that labour cost % can.
 *   comms and retention — company-wide by construction.
 *
 * Offering those per person would render "no data" forever, or worse, show the
 * COMPANY figure beside somebody's name. So the target screen hides them for a
 * person and the API refuses them.
 */

export const GOAL_GRAINS = ['month', 'quarter', 'year'] as const
export type GoalGrain = (typeof GOAL_GRAINS)[number]

/** Groups the target picker, which is far too long to read as one flat list. */
export const GOAL_METRIC_GROUPS = [
  'Money in',
  'Sales',
  'Work produced',
  'Efficiency',
  'Customers',
  'Answering the phone',
] as const
export type GoalMetricGroup = (typeof GOAL_METRIC_GROUPS)[number]

export type GoalMetric = {
  key: string
  label: string
  /** Which section of the picker this sits in. */
  group: GoalMetricGroup
  /** How the target and actual are rendered. `duration` is a count of seconds. */
  format: 'currency' | 'number' | 'percent' | 'duration'
  /** Accumulates through the period, so pace is meaningful. See the header. */
  cumulative: boolean
  /**
   * Which way is good. ⚠ 'lower' means the target is a ceiling — hit by coming in
   * at or below it — and inverts attainment. See the header.
   */
  direction: 'higher' | 'lower'
  /**
   * When a verdict can be given. 'period_end' shows the running figure but no
   * pass/fail until the period is over, for measures that can only be read as a
   * share of the whole period. See the header.
   */
  judge: 'running' | 'period_end'
  /** Period lengths this can be set for. Absent means all of them. */
  grains?: readonly GoalGrain[]
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
  /**
   * A warning shown ONLY once a person is picked, for a measure that is per-person
   * capable but not per-person meaningful for everybody. Distinct from
   * `perPersonBlocker`, which refuses the option outright: this one allows it and
   * says who it will lie about. Labour cost % is the case that forced it — the
   * figure is exact for a technician and worthless for an office role whose work
   * nobody credits.
   */
  perPersonCaution?: string
}

/** Defaults every metric shares, so each entry states only what is unusual. */
const base = { direction: 'higher', judge: 'running' } as const

export const GOAL_METRICS: GoalMetric[] = [
  // ── Money in ───────────────────────────────────────────────────────────────
  {
    ...base,
    key: 'invoiced',
    label: 'Invoiced',
    group: 'Money in',
    format: 'currency',
    cumulative: true,
    help: 'Work billed in the period, excluding drafts. Matches the Revenue report.',
    perPerson: false,
    perPersonBlocker: 'Invoices name a salesperson on only about a third of rows, so one person’s billed total would leave most of it out.',
  },
  {
    ...base,
    key: 'collected',
    label: 'Cash collected',
    group: 'Money in',
    format: 'currency',
    cumulative: true,
    help: 'Payments received against invoices in the period.',
    perPerson: false,
    perPersonBlocker: 'A payment does not record who sold the work, so it cannot be credited to a person.',
  },
  {
    ...base,
    key: 'collection_rate',
    label: 'Collection rate',
    group: 'Money in',
    format: 'percent',
    cumulative: false,
    judge: 'period_end',
    help: 'Share of what you billed in the period that has been paid. Judged when the period ends: an invoice raised three days ago has not failed to be collected, so the figure always reads low mid-period and climbs as the money arrives.',
    perPerson: false,
    perPersonBlocker: 'Neither half of this can be credited to a person — invoices name a salesperson on about a third of rows and payments name nobody.',
  },

  // ── Sales ──────────────────────────────────────────────────────────────────
  {
    ...base,
    key: 'leads',
    label: 'Leads',
    group: 'Sales',
    format: 'number',
    cumulative: true,
    help: 'Leads created in the period, the same cohort the close rate uses. ⚠ This one counts ARRIVALS, unlike the value and count measures below, which count deals by the date they were sold — a lead count is a question about arrivals by definition.',
    perPerson: true,
  },
  {
    ...base,
    key: 'won_value',
    label: 'Value sold (all)',
    group: 'Sales',
    format: 'currency',
    cumulative: true,
    help: 'Annual value of everything sold in the period — new business and upsells together. Counted in the period the deal was SOLD, not the period its lead arrived, which is the same rule the commission bases use.',
    perPerson: true,
  },
  {
    ...base,
    key: 'new_business_value',
    label: 'Value sold — new business',
    group: 'Sales',
    format: 'currency',
    cumulative: true,
    help: 'Value sold to customers you competed for, with upsells taken out, counted in the period the deal was sold. Worked out by subtraction from the same figures, so the two can never disagree about what a deal was.',
    perPerson: true,
  },
  {
    ...base,
    key: 'upsell_value',
    label: 'Value sold — upsells',
    group: 'Sales',
    format: 'currency',
    cumulative: true,
    help: 'Value of extra work sold to customers you already had, counted in the period it was sold. Counts every stage ticked as a sale in the Lead Tracker.',
    perPerson: true,
  },
  {
    ...base,
    key: 'won_count',
    label: 'Deals won',
    group: 'Sales',
    format: 'number',
    cumulative: true,
    help: 'How many deals were sold in the period, however big — counted by the date they were sold.',
    perPerson: true,
  },
  {
    ...base,
    key: 'avg_deal',
    label: 'Average deal size',
    group: 'Sales',
    format: 'currency',
    cumulative: false,
    help: 'Value sold divided by deals won, both counted by the date the deal was sold. A rate, so no pace is shown — and a slow month with two big jobs will swing it.',
    perPerson: true,
  },
  {
    ...base,
    key: 'close_rate',
    label: 'Close rate',
    group: 'Sales',
    format: 'percent',
    cumulative: false,
    help: 'Share of decided leads won, out of the leads that ARRIVED in the period. ⚠ Deliberately not counted by close date like the value measures: over deals that closed, the share that closed would be 100% by construction — the cohort is the denominator. A rate, so no pace is shown.',
    perPerson: true,
  },
  {
    ...base,
    key: 'quotes_sent',
    label: 'Quotes sent',
    group: 'Sales',
    format: 'number',
    cumulative: true,
    help: 'Jobber quotes sent in the period. An activity target — quotes carry no value until a customer approves what they want.',
    perPerson: false,
    perPersonBlocker: 'Quotes name a salesperson, but that name is not carried into the People report, so a person’s quote figure would come from a different place than the rest of their numbers.',
  },
  {
    ...base,
    key: 'quote_win_rate',
    label: 'Quote win rate',
    group: 'Sales',
    format: 'percent',
    cumulative: false,
    help: 'Share of decided quotes approved. Reads "no data" in a period with too few decisions to rate fairly, rather than a rate built on two or three.',
    perPerson: false,
    perPersonBlocker: 'Quotes name a salesperson, but that name is not carried into the People report, so a person’s quote figure would come from a different place than the rest of their numbers.',
  },

  // ── Work produced ──────────────────────────────────────────────────────────
  {
    ...base,
    key: 'visit_revenue',
    label: 'Work produced',
    group: 'Work produced',
    format: 'currency',
    cumulative: true,
    help: 'Revenue from visits actually completed in the period — work done, not work billed. This is the number that moves when the crews are busy.',
    perPerson: true,
  },
  {
    ...base,
    key: 'rev_per_visit',
    label: 'Revenue per visit',
    group: 'Work produced',
    format: 'currency',
    cumulative: false,
    help: 'Work produced divided by visits completed. A rate, and measured over the days timeclock data covers.',
    perPerson: false,
    perPersonBlocker: 'The visit count behind this is not broken down per person, so one person’s figure cannot be worked out.',
  },

  // ── Efficiency ─────────────────────────────────────────────────────────────
  {
    ...base,
    key: 'rev_per_labor_hour',
    label: 'Revenue per labour hour',
    group: 'Efficiency',
    format: 'currency',
    cumulative: false,
    help: 'Revenue divided by clocked hours. A rate, and clamped to where timeclock data exists.',
    perPerson: true,
  },
  {
    ...base,
    key: 'labor_pct',
    direction: 'lower',
    label: 'Labour cost as a share of revenue',
    group: 'Efficiency',
    format: 'percent',
    cumulative: false,
    /* ⚠⚠ THE COMPANY TARGET AND A PERSON'S TARGET ARE DIFFERENT QUESTIONS sharing
     * one name. The company figure divides field pay by ALL completed work,
     * including work no technician is credited with; a person's divides their pay
     * by the work credited to them, and a visit worked by two people credits BOTH
     * — so personal figures do not add up to the company one and read slightly low.
     * Heroes' July 2026: company 27.2%, the six measurable people 12.7% to 89.5%.
     * Carrying one target across to the other sets a bar nobody can be judged
     * against, which is why the help text says so before a number is typed.
     *
     * This was company-only until Aug 20 2026 on the grounds that it "divides wages
     * by COMPANY revenue, which is not fanned out per person". True of the company
     * calculation and of nothing else: `scoreboard_crew_labor` has always held each
     * person's pay beside their credited revenue — `kpi_person_labor_cost_pct` puts
     * it on a board and the commission engine PAYS on it. The only thing missing was
     * that `scoreboard_people` dropped the pay figure on the way through. */
    help: 'Wages as a percentage of the work produced. A ceiling, not a floor — the target is hit by coming in at or below it. Measured over the days timeclock data covers. Set for one person it becomes their own pay over the work credited to them — a different number from the company one, so do not reuse the same target for both.',
    perPerson: true,
    perPersonCaution: 'Only meaningful for someone whose completed work is credited to them. Office and support staff clock real hours against almost no credited revenue, so their percentage looks catastrophic and means nothing — on the live book one reads 89.5%. Anyone with no credited work at all reads “No data” rather than a flattering 0%.',
  },

  // ── Customers ──────────────────────────────────────────────────────────────
  {
    ...base,
    key: 'new_customers',
    label: 'New customers',
    group: 'Customers',
    format: 'number',
    cumulative: true,
    help: 'Customers added in the period. Matches the Clients report.',
    perPerson: false,
    perPersonBlocker: 'The Clients report does not break new customers down by person, and working one out separately would disagree with it.',
  },
  {
    ...base,
    key: 'retention_pct',
    label: 'Customer retention (year)',
    group: 'Customers',
    format: 'percent',
    cumulative: false,
    judge: 'period_end',
    grains: ['year'],
    help: 'Share of the year’s recurring book kept. Yearly only — the retention figure is a share of the whole year, so a month is not a smaller version of it. The running figure is shown all year but no pass or fail is given until the year is over, because cancellations have not happened yet in January.',
    perPerson: false,
    perPersonBlocker: 'Retention is a property of the customer book, not of a person.',
  },
  {
    ...base,
    key: 'controllable_churn_pct',
    direction: 'lower',
    label: 'Controllable churn (year)',
    group: 'Customers',
    format: 'percent',
    cumulative: false,
    judge: 'period_end',
    grains: ['year'],
    help: 'Share of the book lost for reasons you could have changed — price, quality, service — excluding moves and sales. A ceiling: hit by coming in at or below it. Yearly only, and judged when the year is over.',
    perPerson: false,
    perPersonBlocker: 'Churn is a property of the customer book, not of a person.',
  },

  // ── Answering the phone ────────────────────────────────────────────────────
  {
    ...base,
    key: 'missed_call_pct',
    direction: 'lower',
    label: 'Missed-call rate',
    group: 'Answering the phone',
    format: 'percent',
    cumulative: false,
    help: 'Share of inbound calls nobody answered. A ceiling: hit by coming in at or below it. Every missed call is a customer who may just ring the next company.',
    perPerson: false,
    perPersonBlocker: 'The People report holds no call figures for a person, and the routing stamp on a call is written before it is offered to anyone — so it cannot say who missed it.',
  },
  {
    ...base,
    key: 'answer_seconds',
    direction: 'lower',
    label: 'Time to answer a call (median)',
    group: 'Answering the phone',
    format: 'duration',
    cumulative: false,
    help: 'The middle call’s wait before somebody picked up. Set the target in SECONDS — 20 means twenty seconds. A ceiling: hit by coming in at or below it.',
    perPerson: false,
    perPersonBlocker: 'The People report holds no call figures for a person.',
  },
  {
    ...base,
    key: 'reply_seconds',
    direction: 'lower',
    label: 'Text reply time (median)',
    group: 'Answering the phone',
    format: 'duration',
    cumulative: false,
    help: 'The middle customer text’s wait for a reply. Set the target in SECONDS — 300 means five minutes. A ceiling: hit by coming in at or below it.',
    perPerson: false,
    perPersonBlocker: 'The People report holds no text figures for a person.',
  },
  {
    ...base,
    key: 'outbound_calls',
    label: 'Outbound calls made',
    group: 'Answering the phone',
    format: 'number',
    cumulative: true,
    help: 'Calls the team placed in the period. An activity target for follow-up discipline.',
    perPerson: false,
    perPersonBlocker: 'The People report holds no call figures for a person.',
  },
]

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
 * Whether this measure can be set for a period of this length.
 *
 * ⚠ An unknown key answers false, for the same reason as above: a metric nothing
 * recognises must not become settable at every grain by default.
 */
export function metricAllowsGrain(key: string, grain: GoalGrain): boolean {
  const m = getGoalMetric(key)
  if (!m) return false
  return (m.grains ?? GOAL_GRAINS).includes(grain)
}

/** The grains this measure accepts, for the screen to offer. */
export function grainsForMetric(key: string): readonly GoalGrain[] {
  return getGoalMetric(key)?.grains ?? GOAL_GRAINS
}

/**
 * The measures that get no pace figure, named.
 *
 * ⚠ Derived, never written out. The report used to say "blank for close rate and
 * revenue per hour" in three places; with a dozen rate measures that sentence
 * became false the moment one was added, while still reading as authoritative.
 */
export function rateMetricLabels(): string[] {
  return GOAL_METRICS.filter(m => !m.cumulative).map(m => m.label)
}

/** The measures that can belong to one person, named. Derived for the same reason. */
export function perPersonMetricLabels(): string[] {
  return PER_PERSON_GOAL_METRICS.map(m => m.label)
}

/**
 * The measures counted by the date a deal was SOLD rather than the date its lead
 * arrived. See the header note.
 *
 * ⚠ Declared as one list here and derived everywhere else, so the Goals card, the help
 * text and the commission bases cannot end up naming different sets — a note claiming
 * a measure uses close date while the SQL uses arrival date would be worse than no note.
 */
export const CLOSE_DATE_GOAL_METRICS = ['won_value', 'new_business_value', 'upsell_value', 'won_count', 'avg_deal'] as const

export function isCloseDateMetric(key: string): boolean {
  return (CLOSE_DATE_GOAL_METRICS as readonly string[]).includes(key)
}

export function closeDateMetricLabels(): string[] {
  return GOAL_METRICS.filter(m => isCloseDateMetric(m.key)).map(m => m.label)
}

/** Measures where the target is a ceiling rather than a floor, named. */
export function lowerIsBetterMetricLabels(): string[] {
  return GOAL_METRICS.filter(m => m.direction === 'lower').map(m => m.label)
}

/** Join a list of names the way a sentence would. */
export function nameList(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
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
