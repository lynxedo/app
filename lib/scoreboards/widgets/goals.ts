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

const STATUS_TEXT: Record<GoalRow['status'], string> = {
  hit: 'Hit',
  missed: 'Missed',
  on_track: 'On track',
  behind: 'Behind',
  open: 'Not started',
  unknown: 'No data',
}

const STATUS_TONE: Record<GoalRow['status'], Tone> = {
  hit: 'good',
  missed: 'bad',
  on_track: 'good',
  behind: 'warn',
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
          { key: 'period', label: 'Period', align: 'left' },
          { key: 'target', label: 'Target', align: 'right' },
          { key: 'actual', label: 'Actual', align: 'right' },
          { key: 'attainment', label: 'Attainment', align: 'right', format: 'percent', sortable: true },
          { key: 'pace', label: 'Should be at', align: 'right', title: 'The target prorated to today. Blank for rates, which do not accumulate.' },
          { key: 'status', label: 'Status', align: 'left' },
        ],
        rows,
        empty: 'No targets set yet. An admin can add them in Admin → Goals.',
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
          label: `${getGoalMetric(g.metric)?.label ?? g.metric} · ${periodLabel(g.grain, g.period_start)}`,
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
      if (r && r.total_in_window === 0) {
        items.unshift('No targets are set for this range yet. An admin adds them in Admin → Goals.')
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
