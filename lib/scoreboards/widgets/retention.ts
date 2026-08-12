/* Retention & churn widgets — the library behind Report §8.5.
 *
 * Ported from buildRetentionBoard (the hardcoded Board 7), one widget per thing it
 * drew, so the same metrics now serve both a preset Report and anyone composing a
 * Scoreboard.
 *
 * ⚠ These are YEAR-based on purpose. Retention here is "of every recurring service
 * on the books during year Y, the share kept" — the full-year-book method from the
 * July rework. A two-week slice of that is not a smaller version of the same
 * number, it is a different and flattering one (nothing cancels in two weeks, so it
 * reads ~100%). So each widget takes the year the board's window ENDS in and says
 * so in its own subtitle. That is the difference between an honest simplification
 * and the Source Coverage bug, where a number silently disagreed with its label.
 */

import { formatCurrency } from '@/lib/format'
import type { ChurnSummaryRow } from './sources'
import type { SourceBag, WidgetDef, WidgetConfig, WindowSpec } from './types'
import { windowYear, currentBusinessYear } from './windows'
import type { Tone, WidgetPayload } from './payloads'

/**
 * Link from a figure to the rows behind it, carrying the CURRENT window so the
 * list is the same slice the number was read in. Point-in-time drill-downs
 * ignore the dates and say so on their own page.
 */
function drillTo(report: string, key: string, win: WindowSpec, label?: string) {
  return { href: `/hub/reports/${report}/${key}?start=${win.start}&end=${win.end}`, label }
}


const yearReq = (year: number) => ({ source: 'churn_summary' as const, params: { year } })

function summary(bag: SourceBag, year: number): ChurnSummaryRow | null {
  return bag.get<ChurnSummaryRow>(yearReq(year))[0] ?? null
}

/** Retention thresholds — same bands the rest of the boards use. */
function retentionTone(pct: number | null): Tone {
  if (pct == null) return 'neutral'
  return pct >= 90 ? 'good' : pct >= 80 ? 'warn' : 'bad'
}

/** Churn types, coloured by whether we could have done something about it. */
function churnTypeTone(type: string): Tone {
  switch (type) {
    case 'Controllable': return 'bad'          // the part worth fighting
    case 'Uncontrollable': return 'neutral'    // moves, deaths — not operations
    case 'Company-Initiated': return 'mixed'   // we ended it on purpose
    case 'Not-Churn': return 'free'
    default: return 'unknown'                  // Review — needs a reason tagged
  }
}

/**
 * How to describe the year being shown.
 *
 * ⚠ `churn_summary(year)` always returns that ENTIRE year's book — it never sees
 * the window's individual days. So the only thing that varies is whether the year
 * has finished. Describing a March–May window as "2026 to date" would be a lie
 * about the window; describing it as "2026 to date" is the truth about the DATA,
 * which is what the card is showing.
 */
function yearPhrase(_win: WindowSpec, year: number): string {
  return year >= currentBusinessYear() ? `${year} to date` : `${year} full year`
}

export const RETENTION_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'kpi_retention_rate',
    group: 'Retention',
    title: 'Retention Rate',
    blurb: "Share of the year's recurring book kept",
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [yearReq(windowYear(win))],
    metric: (bag, _cfg, win) => {
      const year = windowYear(win)
      const s = summary(bag, year)
      return {
        kind: 'kpi',
        label: 'Retention Rate',
        value: s?.retention_pct != null ? `${s.retention_pct}%` : '—',
        tone: retentionTone(s?.retention_pct ?? null),
        sub: s
          ? `${yearPhrase(win, year)} · kept ${s.book_size - s.churned_gross} of ${s.book_size} on the books`
          : 'No recurring book for this year',
      }
    },
  },

  {
    type: 'kpi_controllable_churn',
    group: 'Retention',
    title: 'Controllable Churn',
    blurb: 'The cancellations we could have influenced',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [yearReq(windowYear(win))],
    metric: (bag, _cfg, win) => {
      const year = windowYear(win)
      const s = summary(bag, year)
      const ctrl = s?.by_type.find(t => t.churn_type === 'Controllable')
      return {
        kind: 'kpi',
        label: 'Controllable Churn',
        value: s?.controllable_churn_pct != null ? `${s.controllable_churn_pct}%` : '—',
        tone: (s?.controllable_churn_pct ?? 0) >= 10 ? 'bad' : (s?.controllable_churn_pct ?? 0) >= 5 ? 'warn' : 'good',
        sub: s
          ? `${s.churned_controllable} of ${s.churned_gross} cancels${ctrl ? ` · ${formatCurrency(ctrl.annual_value)}/yr lost` : ''}`
          : 'Nothing cancelled yet',
      }
    },
  },

  {
    type: 'kpi_book_size',
    group: 'Retention',
    title: 'Recurring Book',
    blurb: 'Services on the books, and what they are worth',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [yearReq(windowYear(win))],
    metric: (bag, _cfg, win) => {
      const s = summary(bag, windowYear(win))
      return {
        kind: 'kpi',
        label: 'Active Recurring Services',
        value: s ? s.active_now.toLocaleString() : '—',
        sub: s ? `${formatCurrency(s.active_annual_value)}/yr · ${s.new_in_year} sold this year` : 'No recurring book',
        drill: { href: '/hub/reports/retention/recurring-customers', label: 'See the recurring book' },
      }
    },
  },

  {
    type: 'kpi_lost_value',
    group: 'Retention',
    title: 'Lost Annual Value',
    blurb: 'Yearly revenue walked out the door',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [yearReq(windowYear(win))],
    metric: (bag, _cfg, win) => {
      const year = windowYear(win)
      const s = summary(bag, year)
      return {
        kind: 'kpi',
        label: 'Lost Annual Value',
        value: s ? formatCurrency(s.churned_annual_value) : '—',
        tone: (s?.churned_annual_value ?? 0) > 0 ? 'bad' : 'neutral',
        sub: s ? `${s.churned_gross} cancellations in ${yearPhrase(win, year)}` : 'Nothing cancelled',
        drill: drillTo('retention', 'cancellations', win, 'See who cancelled'),
      }
    },
  },

  {
    /* The one widget that reads TWO years — and the clearest demonstration that a
     * widget declaring several source requests still costs only the queries the
     * whole board needs, deduped. */
    type: 'retention_by_year',
    group: 'Retention',
    title: 'Retention by Year',
    blurb: 'This year beside the last finished one',
    defaultSpan: 6,
    config: {
      years: { kind: 'number', label: 'Years to show', def: 2, min: 2, max: 5, unit: 'years' },
    },
    sources: (cfg, win) => {
      const end = windowYear(win)
      const n = Number(cfg.years)
      return Array.from({ length: n }, (_, i) => yearReq(end - i))
    },
    metric: (bag, cfg, win) => {
      const end = windowYear(win)
      const n = Number(cfg.years)
      const rows = Array.from({ length: n }, (_, i) => end - i)
        .map(y => ({ y, s: summary(bag, y) }))
        // A year with no book behind it is noise, not a zero.
        .filter(r => r.s && r.s.book_size > 0)
        .reverse()
        .map(r => ({
          label: r.y === end ? `${r.y} YTD` : String(r.y),
          value: r.s!.retention_pct ?? 0,
          tone: retentionTone(r.s!.retention_pct),
          detail: `${r.s!.book_size} on the books · ${r.s!.churned_gross} cancelled`,
        }))
      return {
        kind: 'bars',
        title: 'Retention by Year',
        sub: 'The current year is part-way through, so it starts high and drifts down',
        format: 'percent',
        rows,
        empty: 'Not enough history yet',
      }
    },
  },

  {
    type: 'churn_by_reason',
    group: 'Retention',
    title: 'Why Customers Left',
    blurb: 'Cancellations ranked by reason',
    defaultSpan: 6,
    config: {
      topN: { kind: 'number', label: 'Show top', def: 10, min: 3, max: 26, unit: 'reasons' },
    },
    sources: (_cfg, win) => [yearReq(windowYear(win))],
    metric: (bag, cfg, win) => {
      const year = windowYear(win)
      const s = summary(bag, year)
      const rows = (s?.by_reason ?? [])
        .slice()
        .sort((a, b) => b.count - a.count)
        .slice(0, Number(cfg.topN))
        .map(r => ({
          label: r.reason,
          value: r.count,
          tone: churnTypeTone(r.churn_type),
          detail: `${r.churn_type} · ${formatCurrency(r.annual_value)}/yr`,
        }))
      return {
        kind: 'bars',
        title: 'Why Customers Left',
        sub: `${yearPhrase(win, year)} · coloured by whether we could influence it`,
        format: 'number',
        rows,
        legend: [
          { label: 'Controllable', tone: 'bad' },
          { label: 'Uncontrollable', tone: 'neutral' },
          { label: 'Company-initiated', tone: 'mixed' },
          { label: 'Needs a reason', tone: 'unknown' },
        ],
        empty: 'No cancellations to explain',
      }
    },
  },

  {
    type: 'churn_by_type',
    group: 'Retention',
    title: 'Controllable vs Not',
    blurb: 'Churn split by whether it was ours to prevent',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [yearReq(windowYear(win))],
    metric: (bag, _cfg, win) => {
      const year = windowYear(win)
      const s = summary(bag, year)
      const parts = (s?.by_type ?? [])
        .filter(t => t.count > 0)
        .map(t => ({ label: t.churn_type, value: t.count, tone: churnTypeTone(t.churn_type) }))
      return {
        kind: 'donut',
        title: 'Controllable vs Not',
        sub: `${yearPhrase(win, year)} · ${s?.churned_gross ?? 0} cancellations`,
        parts,
        note: 'Only controllable churn is a scoreboard for operations. Moves, deaths and accounts we ended ourselves are reported separately so they are not blamed on service.',
        empty: 'No cancellations yet',
      }
    },
  },

  {
    type: 'churn_monthly_trend',
    group: 'Retention',
    title: 'Cancellations by Month',
    blurb: 'Monthly churn, with the controllable share',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [yearReq(windowYear(win))],
    metric: (bag, _cfg, win) => {
      const year = windowYear(win)
      const s = summary(bag, year)
      const rows = (s?.monthly ?? []).map(m => ({
        label: new Date(`${m.month}-15T12:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
        caption: String(m.gross),
        // Controllable is a SUBSET of gross, so stack controllable + the remainder.
        // Stacking gross AND controllable would double-count every controllable cancel.
        parts: [
          { value: m.controllable, tone: 'bad' as Tone, label: 'Controllable' },
          { value: Math.max(0, m.gross - m.controllable), tone: 'neutral' as Tone, label: 'Everything else' },
        ],
      }))
      return {
        kind: 'stacked',
        title: 'Cancellations by Month',
        sub: `${yearPhrase(win, year)} · total per month, controllable share in red`,
        rows,
        legend: [{ label: 'Controllable', tone: 'bad' }, { label: 'Everything else', tone: 'neutral' }],
        empty: 'No cancellations yet',
      }
    },
  },

  {
    type: 'retention_insights',
    group: 'Retention',
    title: 'What the Numbers Say',
    blurb: 'Plain-language read of retention',
    defaultSpan: 12,
    config: {},
    sources: (_cfg, win) => [yearReq(windowYear(win)), yearReq(windowYear(win) - 1)],
    metric: (bag, _cfg, win) => {
      const year = windowYear(win)
      const s = summary(bag, year)
      const p = summary(bag, year - 1)
      const items: string[] = []
      if (!s) return { kind: 'list', title: 'What the Numbers Say', sub: '', items: [], empty: 'No recurring book for this year' }

      items.push(`${yearPhrase(win, year)}: kept ${s.retention_pct}% of the ${s.book_size} recurring services on the books (${s.churned_gross} cancelled).`)

      if (p && p.book_size > 0 && p.retention_pct != null && s.retention_pct != null) {
        const delta = Math.round((s.retention_pct - p.retention_pct) * 10) / 10
        items.push(`Retention is ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta)} pts vs ${p.year} full year (${p.retention_pct}%) — ${year} is only part-way through, so it will move as the year finishes.`)
      }

      const ctrl = s.by_type.find(t => t.churn_type === 'Controllable')
      if (ctrl && ctrl.count > 0) {
        items.push(`Controllable churn — the part we can fight — is ${s.churned_controllable} of ${s.churned_gross} cancels (${formatCurrency(ctrl.annual_value)}/yr in lost value).`)
      }

      if (s.monthly.length > 1) {
        const worst = [...s.monthly].sort((a, b) => b.gross - a.gross)[0]
        const label = new Date(`${worst.month}-15T12:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
        items.push(`Worst month: ${label} (${worst.gross} cancellations).`)
      }

      if (s.churned_review > 0) {
        items.push(`${s.churned_review} cancellation${s.churned_review === 1 ? ' has' : 's have'} no usable reason — tag them on the Recurring Services board so they count toward the right bucket.`)
      }

      return { kind: 'list', title: 'What the Numbers Say', sub: `Read of ${yearPhrase(win, year)}`, items }
    },
  },
]

/** The arrangement Report §8.5 ships with — Board 7's layout, as widgets. */
export const RETENTION_REPORT_PRESET: { type: string; span: number; config?: WidgetConfig }[] = [
  { type: 'kpi_retention_rate', span: 3 },
  { type: 'kpi_controllable_churn', span: 3 },
  { type: 'kpi_book_size', span: 3 },
  { type: 'kpi_lost_value', span: 3 },
  { type: 'retention_insights', span: 12 },
  { type: 'retention_by_year', span: 6 },
  { type: 'churn_by_type', span: 6 },
  { type: 'churn_by_reason', span: 6 },
  { type: 'churn_monthly_trend', span: 6 },
]
