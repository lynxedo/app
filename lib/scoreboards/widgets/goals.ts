/* Goals & Targets widgets — the library behind Report §8.11.
 *
 * The only report section that measures against something a human typed rather
 * than something the business did, which creates one failure mode the others do
 * not have: a target with no actual behind it still looks authoritative. So
 * every figure here names the period it was judged over, and a metric whose
 * actual could not be computed says "unknown" rather than scoring zero.
 *
 * ⚠⚠ PACE IS ONLY SHOWN FOR METRICS THAT ACCUMULATE. Invoiced, collected, leads
 * and value sold pile up through a period, so "you should be at £X by now" is
 * real guidance. A close rate does not accumulate — being 40% through the month
 * does not mean you should have 40% of your close rate — so rate metrics show
 * attainment and NO pace. The source returns `expected_by_now: null` for them
 * and these cards leave the column blank rather than inventing a number.
 *
 * ⚠ Actuals are computed over each goal's OWN period, not the range at the top
 * of the screen: an August target is judged against August whatever window is
 * selected. The range decides which goals are listed, nothing more.
 *
 * ⚠⚠ A target belongs either to the company or to ONE PERSON, and every card
 * here says which — a row reading "90%" means something very different about the
 * business than about Mike. A person's actual comes from `scoreboard_people`, the
 * same composer the People report and commission are built on, so a person's goal
 * cannot disagree with the report it is judged against. Only four measures can be
 * scoped to a person at all; `lib/reports/goals.ts` documents why the other three
 * cannot, and both the API and the target screen refuse them.
 */

import { formatCurrency, formatDurationSec } from '@/lib/format'
import {
  GOAL_METRICS, getGoalMetric, periodLabel, nameList,
  rateMetricLabels, perPersonMetricLabels, lowerIsBetterMetricLabels,
} from '@/lib/reports/goals'
import type { GoalRow, GoalsRow } from './sources'
import type { SourceBag, WidgetConfig, WidgetDef, WindowSpec } from './types'
import type { Tone, WidgetPayload } from './payloads'

/** How many measures accumulate, for the foot note's arithmetic. */
const GOAL_CUMULATIVE_COUNT = GOAL_METRICS.filter(m => m.cumulative).length

const goalsReq = (win: WindowSpec) => ({
  source: 'goals' as const,
  params: { start: win.start, end: win.end },
})

function data(bag: SourceBag, win: WindowSpec): GoalsRow | null {
  return bag.get<GoalsRow>(goalsReq(win))[0] ?? null
}

function num(v: number | string | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Render a value in its metric's own units. */
function fmt(metricKey: string, v: number | null | undefined): string {
  if (v == null) return '—'
  const m = getGoalMetric(metricKey)
  if (!m) return String(v)
  if (m.format === 'currency') return formatCurrency(num(v))
  if (m.format === 'percent') return `${num(v)}%`
  // Held in seconds so it matches the report's own figure; read back as a time,
  // because "300" beside a reply-time target tells nobody it means five minutes.
  if (m.format === 'duration') return formatDurationSec(num(v), { style: 'verbose', seconds: true })
  return num(v).toLocaleString()
}

/**
 * Whose target this is, for display.
 *
 * ⚠ A person target whose name could not be resolved says so rather than falling
 * back to "Company" — mislabelling one person's number as the whole business's is
 * the one error this column exists to prevent.
 */
function whose(g: GoalRow): string {
  if (!g.employee_id) return 'Company'
  return g.person_name || 'Someone no longer on the roster'
}

/**
 * The target as it should read.
 *
 * ⚠ A ceiling is marked "≤". Without it a labour-cost row showing "22%" beside an
 * actual of 23.8% looks like a target that was beaten, since every other row on
 * the table is a floor.
 */
function fmtTarget(g: GoalRow): string {
  const t = fmt(g.metric, g.target)
  return g.direction === 'lower' ? `≤ ${t}` : t
}

/* ── Whose targets a card shows ─────────────────────────────────────────────
 *
 * Ben: "we need to overhaul the goal widgets so we can just show one person's goal
 * on a scoreboard."
 *
 * ⚠⚠ Applied in the pure metric, never pushed into the source — the same property
 * every other person filter in the library relies on (see people-filter.ts). The
 * filter can only REMOVE rows the viewer was already sent, so it composes with the
 * report gate rather than reaching around it, and a Mike card plus a company card on
 * one board still cost ONE round trip.
 *
 * ⚠⚠ Matched on `employee_id`, not on a name. This is the only picker in the library
 * that can do that — every chart elsewhere carries only a name, while a goal row
 * carries the roster id the target is stored against. So the filter keeps working
 * after somebody's preferred name changes, which the name-matched pickers knowingly
 * cannot.
 *
 * ⚠ "The company only" exists because a shared board should not start listing
 * everybody's personal targets the day somebody sets one — and the reverse: a
 * person's own card showing the company's number beside theirs reads as theirs.
 */
const WHOSE_EVERYONE = 'Everyone'
const WHOSE_COMPANY = 'The company only'
const WHOSE_PEOPLE = 'Only the people I pick'

const GOAL_SCOPE_CONFIG = {
  whose: {
    kind: 'enum' as const,
    label: 'Whose targets',
    def: WHOSE_EVERYONE,
    opts: [WHOSE_EVERYONE, WHOSE_COMPANY, WHOSE_PEOPLE],
    hint: 'Company-wide targets are left off a card built for particular people, so somebody\u2019s own scoreboard shows their number and not the whole business\u2019s beside it.',
  },
  people: {
    kind: 'catalog' as const,
    label: 'Which people',
    def: [] as string[],
    catalog: 'goal_people' as const,
    hint: 'Only used when "Whose targets" is set to the people you pick. Lists only people who already hold a target.',
  },
}

type GoalScope = {
  mode: 'everyone' | 'company' | 'people'
  ids: Set<string>
  /** Showing less than everything, so the card has to say so. */
  narrowed: boolean
  /**
   * Set to people, but nobody picked yet. ⚠ Its own state on purpose: rendering
   * everyone would contradict the setting, and rendering an empty card with no
   * explanation reads as "this person has no targets" when nothing was chosen.
   */
  unset: boolean
}

/**
 * ⚠ An unrecognised or absent `whose` means EVERYONE, which is both the old behaviour
 * (so every board saved before this setting existed is unchanged) and the safe
 * direction: the scope is a DISPLAY choice, not a permission. Anyone who can see a
 * Goals card already holds the Goals report grant, which shows every target — so
 * failing open widens nothing.
 */
function goalScope(cfg: WidgetConfig): GoalScope {
  const whose = String(cfg.whose ?? WHOSE_EVERYONE)
  const raw = cfg.people
  const ids = new Set(
    (Array.isArray(raw) ? raw.map(String).map(v => v.trim()).filter(Boolean) : []),
  )
  const mode = whose === WHOSE_COMPANY ? 'company' : whose === WHOSE_PEOPLE ? 'people' : 'everyone'
  return { mode, ids, narrowed: mode !== 'everyone', unset: mode === 'people' && ids.size === 0 }
}

function keepGoal(g: GoalRow, s: GoalScope): boolean {
  if (s.mode === 'company') return !g.employee_id
  if (s.mode === 'people') return !!g.employee_id && s.ids.has(g.employee_id)
  return true
}

/** The rows this card should draw, plus the scope that produced them. */
function scoped(bag: SourceBag, cfg: WidgetConfig, win: WindowSpec):
  { r: GoalsRow | null; goals: GoalRow[]; scope: GoalScope } {
  const r = data(bag, win)
  const scope = goalScope(cfg)
  const all = r?.goals ?? []
  return { r, goals: scope.unset ? [] : all.filter(g => keepGoal(g, scope)), scope }
}

/**
 * Whose targets this card is about, in words.
 *
 * ⚠ Names are resolved from the ROWS rather than the config, because the config holds
 * ids. A person with no target in the window therefore cannot be named — the count is
 * the fallback, which is honest rather than blank.
 */
function scopePhrase(s: GoalScope, goals: GoalRow[]): string | null {
  if (s.mode === 'company') return 'company-wide targets only'
  if (s.mode !== 'people') return null
  if (s.unset) return 'nobody picked yet'
  const names = [...new Set(goals.filter(g => g.employee_id && g.person_name).map(g => g.person_name as string))]
  if (names.length === 1 && s.ids.size === 1) return `${names[0]} only`
  if (names.length > 1 && names.length <= 3 && names.length === s.ids.size) return `${names.join(' + ')} only`
  return `${s.ids.size} ${s.ids.size === 1 ? 'person' : 'people'} only`
}

/** Put the scope in the TITLE too: a tile reading "2 of 3" says nothing about whose. */
function scopeTitle(title: string, s: GoalScope, goals: GoalRow[]): string {
  if (!s.narrowed) return title
  if (s.mode === 'company') return `${title} — company`
  if (s.unset) return title
  const names = [...new Set(goals.filter(g => g.employee_id && g.person_name).map(g => g.person_name as string))]
  if (names.length === 1 && s.ids.size === 1) return `${title} — ${names[0]}`
  return `${title} — ${s.ids.size} ${s.ids.size === 1 ? 'person' : 'people'}`
}

/**
 * The period a row covers, saying when it is the STANDING target for that grain.
 *
 * ⚠ Worth the words: "$50,000 · missed" reads differently when the number is the
 * monthly target that has always been there than when somebody chose it for that
 * month, and the table would otherwise show the two identically.
 */
function periodCell(g: GoalRow): string {
  const label = periodLabel(g.grain, g.period_start)
  if (!g.repeating) return label
  const noun = g.grain === 'month' ? 'monthly' : g.grain === 'quarter' ? 'quarterly' : 'yearly'
  return `${label} · ${noun} target`
}

function withScope(sub: string, s: GoalScope, goals: GoalRow[]): string {
  const p = scopePhrase(s, goals)
  return p ? `${sub} · ${p}` : sub
}

/** What an empty card should say, which depends on WHY it is empty. */
function emptyBecause(s: GoalScope, r: GoalsRow | null): string {
  if (s.unset) return 'Pick at least one person in this card\u2019s settings.'
  if (s.mode === 'people') return 'None of the people picked have a target in this range.'
  if (s.mode === 'company') return 'No company-wide targets in this range.'
  return r && r.total_in_window === 0
    ? 'No targets set yet. An admin can add them in Admin → Reports.'
    : 'No targets in this range.'
}

const STATUS_TEXT: Record<GoalRow['status'], string> = {
  hit: 'Hit',
  missed: 'Missed',
  on_track: 'On track',
  behind: 'Behind',
  // A rate is judged against the target itself, so it is "under", not "behind" —
  // behind implies a pace it does not have.
  under: 'Under target',
  // ⚠ The ceiling twin of "under". Being under a cost target is the GOOD outcome,
  // so the two verdicts cannot share a word.
  over: 'Over target',
  // ⚠ The figure is real; the verdict is not due yet. See the header.
  pending: 'Too early to call',
  open: 'Not started',
  unknown: 'No data',
}

const STATUS_TONE: Record<GoalRow['status'], Tone> = {
  hit: 'good',
  missed: 'bad',
  on_track: 'good',
  behind: 'warn',
  under: 'warn',
  over: 'warn',
  // Neutral, deliberately: an unfinished retention year is not a warning.
  pending: 'neutral',
  open: 'neutral',
  unknown: 'unknown',
}

export const GOALS_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'kpi_goals_on_track',
    group: 'Goals',
    title: 'Goals on track',
    blurb: 'How many targets are being met',
    defaultSpan: 3,
    config: { ...GOAL_SCOPE_CONFIG },
    sources: (_cfg, win) => [goalsReq(win)],
    metric: (bag, cfg, win) => {
      const { r, goals, scope } = scoped(bag, cfg, win)
      // ⚠ A target with no verdict due yet is left out of BOTH halves rather than
      // counted against you. An annual retention goal reads 'pending' all year, so
      // scoring it as "not on track" would make this tile say 3 of 4 for a business
      // doing nothing wrong.
      const open = goals.filter(g => !g.closed)
      // ⚠ Two kinds of target are left out of BOTH halves rather than counted
      // against you: one whose verdict is not due yet, and one nothing can measure.
      // Found by rendering a real board — a stale measure and an unfinished
      // retention year were both being scored as "not on track", so the tile read
      // 2 of 8 for a business that was failing neither.
      const live = open.filter(g => g.status !== 'pending' && g.status !== 'unknown')
      const waiting = open.filter(g => g.status === 'pending').length
      const unmeasured = open.filter(g => g.status === 'unknown').length
      const good = live.filter(g => g.status === 'hit' || g.status === 'on_track').length
      if (!r || live.length === 0) {
        return {
          kind: 'kpi',
          label: scopeTitle('Goals on track', scope, goals),
          value: '—',
          sub: waiting || unmeasured
            ? `${waiting + unmeasured} target${waiting + unmeasured === 1 ? '' : 's'} open, none of them judgeable yet`
            : emptyBecause(scope, r),
        }
      }
      return {
        kind: 'kpi',
        label: scopeTitle('Goals on track', scope, goals),
        value: `${good} of ${live.length}`,
        tone: good === live.length ? 'good' : good === 0 ? 'bad' : 'warn',
        sub: [
          withScope(`${win.phrase} · targets still open`, scope, goals),
          waiting ? `${waiting} not judged until the period ends` : null,
          unmeasured ? `${unmeasured} with no data to measure` : null,
        ].filter(Boolean).join(' · '),
      }
    },
  },

  {
    type: 'kpi_goals_hit',
    group: 'Goals',
    title: 'Targets hit',
    blurb: 'Finished periods that made their number',
    defaultSpan: 3,
    config: { ...GOAL_SCOPE_CONFIG },
    sources: (_cfg, win) => [goalsReq(win)],
    metric: (bag, cfg, win) => {
      const { r, goals, scope } = scoped(bag, cfg, win)
      // ⚠ Same rule as the tile beside it: a finished target nothing could measure
      // is not a target that was missed.
      const finished = goals.filter(g => g.closed)
      const closed = finished.filter(g => g.status !== 'unknown')
      const unmeasured = finished.length - closed.length
      const hit = closed.filter(g => g.status === 'hit').length
      return {
        kind: 'kpi',
        label: scopeTitle('Targets hit', scope, goals),
        value: closed.length ? `${hit} of ${closed.length}` : '—',
        tone: closed.length === 0 ? 'neutral' : hit === closed.length ? 'good' : hit === 0 ? 'bad' : 'warn',
        // Only finished periods count here: judging a month that is half over
        // as "missed" would make every current target look like a failure.
        sub: closed.length
          ? withScope(
              ['Periods that have finished', unmeasured ? `${unmeasured} had no data` : null]
                .filter(Boolean).join(' · '), scope, goals)
          : unmeasured
            ? `${unmeasured} finished target${unmeasured === 1 ? '' : 's'} had no data to measure`
            : scope.narrowed ? emptyBecause(scope, r) : 'No period has finished yet',
      }
    },
  },

  {
    type: 'goals_table',
    group: 'Goals',
    title: 'Goal vs actual',
    blurb: 'Every target, what it is at, and whether it is on pace',
    defaultSpan: 12,
    config: { ...GOAL_SCOPE_CONFIG },
    sources: (_cfg, win) => [goalsReq(win)],
    metric: (bag, cfg, win) => {
      const { r, goals, scope } = scoped(bag, cfg, win)
      const rows = goals.map(g => {
        const m = getGoalMetric(g.metric)
        return {
          key: g.id,
          cells: {
            metric: m?.label ?? g.metric,
            who: whose(g),
            period: periodCell(g),
            target: fmtTarget(g),
            actual: fmt(g.metric, g.actual),
            attainment: g.attainment_pct,
            // Blank, not zero, for a rate metric — see the header.
            pace: g.cumulative ? fmt(g.metric, g.expected_by_now) : '—',
            status: STATUS_TEXT[g.status],
          },
          tones: { status: STATUS_TONE[g.status] } as Record<string, Tone>,
          meta: !m
            ? { text: 'This metric is no longer in the catalog', tone: 'unknown' as Tone }
            : g.closed
              ? undefined
              : { text: `${num(g.elapsed_pct)}% of the period gone`, tone: 'neutral' as Tone },
        }
      })
      // ⚠ `shown`/`total_in_window` describe what the report READ, before this card's
      // own filter, so the two facts are stated separately rather than one number
      // being made to stand for both.
      const truncated = r && r.total_in_window > r.shown
      return {
        kind: 'table',
        title: scopeTitle('Goal vs actual', scope, goals),
        sub: r ? withScope(`${rows.length} target${rows.length === 1 ? '' : 's'} overlapping ${win.phrase}`, scope, goals) : win.phrase,
        columns: [
          { key: 'metric', label: 'Goal', align: 'left' },
          { key: 'who', label: 'Whose', align: 'left' },
          { key: 'period', label: 'Period', align: 'left' },
          { key: 'target', label: 'Target', align: 'right' },
          { key: 'actual', label: 'Actual', align: 'right' },
          { key: 'attainment', label: 'Attainment', align: 'right', format: 'percent', sortable: true },
          { key: 'pace', label: 'Should be at', align: 'right', title: 'The target prorated to today. Blank for rates, which do not accumulate.' },
          { key: 'status', label: 'Status', align: 'left' },
        ],
        rows,
        empty: emptyBecause(scope, r),
        foot: [
          // Never let a capped list read as the whole list.
          truncated
            ? `Only the ${r!.shown} most recent of ${r!.total_in_window} targets in this range were read.`
            : null,
          // ⚠ This used to name close rate and revenue per hour, which was true when
          // they were the only two rates. With a dozen, the rule is the honest form
          // — a list here goes stale the moment a measure is added while still
          // reading as authoritative.
          `"Should be at" is the target prorated to today. It is blank for any measure that is a rate rather than a running total (${rateMetricLabels().length} of the ${rateMetricLabels().length + GOAL_CUMULATIVE_COUNT} are): a rate does not build up through a period, so there is no honest half-way number.`,
        ].filter(Boolean).join(' '),
      }
    },
  },

  {
    type: 'goals_progress',
    group: 'Goals',
    title: 'Progress toward each target',
    blurb: 'How far along each open goal is',
    defaultSpan: 6,
    config: { ...GOAL_SCOPE_CONFIG },
    sources: (_cfg, win) => [goalsReq(win)],
    metric: (bag, cfg, win) => {
      const { r, goals, scope } = scoped(bag, cfg, win)
      const live = goals.filter(g => !g.closed && g.attainment_pct != null)
      return {
        kind: 'bars',
        title: scopeTitle('Progress toward each target', scope, goals),
        sub: withScope(`${win.phrase} · targets still open`, scope, goals),
        format: 'percent',
        rows: live.map(g => ({
          // The person is named in the bar itself: a row of bars with no owner
          // reads as company performance at a glance.
          label: [
            getGoalMetric(g.metric)?.label ?? g.metric,
            g.employee_id ? whose(g) : null,
            periodLabel(g.grain, g.period_start),
          ].filter(Boolean).join(' · '),
          value: num(g.attainment_pct),
          tone: STATUS_TONE[g.status],
          // The period's own progress alongside the goal's, so "40% there" can
          // be read against "40% through" without doing the arithmetic.
          detail: `${num(g.elapsed_pct)}% of the period gone`,
        })),
        empty: scope.narrowed || scope.unset ? emptyBecause(scope, r) : 'No open targets in this range',
        legend: [
          { label: 'On track or hit', tone: 'good' },
          { label: 'Behind', tone: 'warn' },
        ],
      }
    },
  },

  {
    type: 'goals_notes',
    group: 'Goals',
    title: 'How these are worked out',
    blurb: 'What a target is measured against',
    defaultSpan: 6,
    config: { ...GOAL_SCOPE_CONFIG },
    sources: (_cfg, win) => [goalsReq(win)],
    metric: (bag, cfg, win) => {
      const { r, goals, scope } = scoped(bag, cfg, win)
      const items = [
        'Each target is measured over its OWN period. An August target is judged against August, whatever range you pick above — the range only decides which targets are listed.',
        'Every actual comes from the report that owns that number, so a goal can never disagree with the report it is measured against.',
        '"Should be at" prorates the target to today. It is blank for any measure that is a rate rather than a running total: a rate does not accumulate through a period, so there is no honest half-way figure.',
      ]
      // ⚠ Each of the next three notes appears only when the thing it explains is
      // actually on screen. A board of plain revenue targets should not be taught
      // the rules for ceilings, people or retention it is not using.
      if (goals.some(g => g.direction === 'lower')) {
        items.push(
          `Some targets are ceilings rather than floors — ${nameList(lowerIsBetterMetricLabels())} are hit by coming in at or BELOW the number, and are shown with a "≤". Their progress is worked out the other way up, so 92% means over budget, not nearly there.`,
        )
      }
      if (goals.some(g => g.repeating)) {
        items.push(
          'A target marked "monthly target" (or quarterly, or yearly) was set once and applies to every period from then on, so each month is judged on its own. Setting a target for one specific month replaces the standing one for that month only.',
        )
      }
      if (scope.mode === 'people') {
        items.push(
          'This card is set to particular people, so company-wide targets are left off it — a personal scoreboard showing the whole business\u2019s number beside somebody\u2019s own would read as theirs.',
        )
      }
      if (scope.mode === 'company') {
        items.push(
          'This card is set to company-wide targets only, so nobody\u2019s personal targets appear on it.',
        )
      }
      if (goals.some(g => g.status === 'pending')) {
        items.push(
          'A target reading "Too early to call" is being measured, but no pass or fail is given until its period ends. Retention and churn can only be read as a share of a whole year, so early in the year they always look good — almost nobody has cancelled yet.',
        )
      }
      // Only explain the person rules when a person's target is actually on
      // screen — a company-only board should not be told about a scope it is
      // not using.
      const people = goals.filter(g => g.employee_id)
      if (people.length > 0) {
        items.push(
          "A person's figures come from the People report, so an individual's target cannot disagree with the report it is judged against.",
          `Only these can be set for one person: ${nameList(perPersonMetricLabels())}. Everything else cannot be split by person honestly — billing, payments, quotes and phone figures do not record who the work belongs to — so they are company-only.`,
          'A person is credited only with leads assigned to them, so individual targets will not add up to a company one — unassigned leads belong to nobody.',
        )
      }
      if (people.some(g => g.metric === 'close_rate' && g.actual == null)) {
        items.push('A close rate reads "no data" until that person has enough decided leads to rate fairly — the same floor the People report uses, rather than a rate built on two or three deals.')
      }
      if (r && r.total_in_window === 0) {
        items.unshift('No targets are set for this range yet. An admin adds them at the bottom of Admin → Reports.')
      } else if (goals.length === 0) {
        // ⚠ Distinct from the line above: targets exist, this card just is not showing
        // any. Saying "none are set" there would send an admin to fix the wrong thing.
        items.unshift(emptyBecause(scope, r))
      }
      return {
        kind: 'list',
        title: scopeTitle('How these are worked out', scope, goals),
        sub: r ? `As of ${r.as_of}` : win.phrase,
        items,
      }
    },
  },
]

export const GOALS_REPORT_PRESET: { type: string; span: number }[] = [
  { type: 'kpi_goals_on_track', span: 3 },
  { type: 'kpi_goals_hit', span: 3 },
  { type: 'goals_table', span: 12 },
  { type: 'goals_progress', span: 6 },
  { type: 'goals_notes', span: 6 },
]
