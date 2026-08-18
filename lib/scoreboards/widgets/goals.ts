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

import { formatCurrency } from '@/lib/format'
import { getGoalMetric, periodLabel } from '@/lib/reports/goals'
import type { GoalRow, GoalsRow } from './sources'
import type { SourceBag, WidgetDef, WindowSpec } from './types'
import type { Tone, WidgetPayload } from './payloads'

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

const STATUS_TEXT: Record<GoalRow['status'], string> = {
  hit: 'Hit',
  missed: 'Missed',
  on_track: 'On track',
  behind: 'Behind',
  // A rate is judged against the target itself, so it is "under", not "behind" —
  // behind implies a pace it does not have.
  under: 'Under target',
  open: 'Not started',
  unknown: 'No data',
}

const STATUS_TONE: Record<GoalRow['status'], Tone> = {
  hit: 'good',
  missed: 'bad',
  on_track: 'good',
  behind: 'warn',
  under: 'warn',
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
    config: {},
    sources: (_cfg, win) => [goalsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = data(bag, win)
      const live = (r?.goals ?? []).filter(g => !g.closed)
      const good = live.filter(g => g.status === 'hit' || g.status === 'on_track').length
      if (!r || live.length === 0) {
        return {
          kind: 'kpi',
          label: 'Goals on track',
          value: '—',
          sub: r && r.total_in_window === 0
            ? 'No targets set for this period'
            : 'No targets still open in this period',
        }
      }
      return {
        kind: 'kpi',
        label: 'Goals on track',
        value: `${good} of ${live.length}`,
        tone: good === live.length ? 'good' : good === 0 ? 'bad' : 'warn',
        sub: `${win.phrase} · targets still open`,
      }
    },
  },

  {
    type: 'kpi_goals_hit',
    group: 'Goals',
    title: 'Targets hit',
    blurb: 'Finished periods that made their number',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [goalsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = data(bag, win)
      const closed = (r?.goals ?? []).filter(g => g.closed)
      const hit = closed.filter(g => g.status === 'hit').length
      return {
        kind: 'kpi',
        label: 'Targets hit',
        value: closed.length ? `${hit} of ${closed.length}` : '—',
        tone: closed.length === 0 ? 'neutral' : hit === closed.length ? 'good' : hit === 0 ? 'bad' : 'warn',
        // Only finished periods count here: judging a month that is half over
        // as "missed" would make every current target look like a failure.
        sub: closed.length ? 'Periods that have finished' : 'No period has finished yet',
      }
    },
  },

  {
    type: 'goals_table',
    group: 'Goals',
    title: 'Goal vs actual',
    blurb: 'Every target, what it is at, and whether it is on pace',
    defaultSpan: 12,
    config: {},
    sources: (_cfg, win) => [goalsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = data(bag, win)
      const rows = (r?.goals ?? []).map(g => {
        const m = getGoalMetric(g.metric)
        return {
          key: g.id,
          cells: {
            metric: m?.label ?? g.metric,
            who: whose(g),
            period: periodLabel(g.grain, g.period_start),
            target: fmt(g.metric, g.target),
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
      const truncated = r && r.total_in_window > r.shown
      return {
        kind: 'table',
        title: 'Goal vs actual',
        sub: r ? `${rows.length} target${rows.length === 1 ? '' : 's'} overlapping ${win.phrase}` : win.phrase,
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
        empty: 'No targets set yet. An admin can add them in Admin → Reports.',
        foot: truncated
          // Never let a capped list read as the whole list.
          ? `Showing ${r!.shown} of ${r!.total_in_window} targets in this range.`
          : '"Should be at" is the target prorated to today, and is blank for close rate and revenue per hour — a rate does not build up through a period, so there is no honest half-way number.',
      }
    },
  },

  {
    type: 'goals_progress',
    group: 'Goals',
    title: 'Progress toward each target',
    blurb: 'How far along each open goal is',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [goalsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = data(bag, win)
      const live = (r?.goals ?? []).filter(g => !g.closed && g.attainment_pct != null)
      return {
        kind: 'bars',
        title: 'Progress toward each target',
        sub: `${win.phrase} · targets still open`,
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
        empty: 'No open targets in this range',
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
    config: {},
    sources: (_cfg, win) => [goalsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = data(bag, win)
      const items = [
        'Each target is measured over its OWN period. An August target is judged against August, whatever range you pick above — the range only decides which targets are listed.',
        'Every actual comes from the report that owns that number, so a goal can never disagree with the report it is measured against.',
        '"Should be at" prorates the target to today. It is blank for close rate and revenue per hour: a rate does not accumulate through a period, so there is no honest half-way figure.',
      ]
      // Only explain the person rules when a person's target is actually on
      // screen — a company-only board should not be told about a scope it is
      // not using.
      const people = (r?.goals ?? []).filter(g => g.employee_id)
      if (people.length > 0) {
        items.push(
          "A person's figures come from the People report, so an individual's target cannot disagree with the report it is judged against.",
          'Only leads, value sold, close rate and revenue per hour can be set for one person. Invoiced, cash collected and new customers cannot be split by person honestly, so they are company-only.',
          'A person is credited only with leads assigned to them, so individual targets will not add up to a company one — unassigned leads belong to nobody.',
        )
      }
      if (people.some(g => g.metric === 'close_rate' && g.actual == null)) {
        items.push('A close rate reads "no data" until that person has enough decided leads to rate fairly — the same floor the People report uses, rather than a rate built on two or three deals.')
      }
      if (r && r.total_in_window === 0) {
        items.unshift('No targets are set for this range yet. An admin adds them at the bottom of Admin → Reports.')
      }
      return {
        kind: 'list',
        title: 'How these are worked out',
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
