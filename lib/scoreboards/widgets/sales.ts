/* Sales & Pipeline widgets — the library behind Report §8.2.
 *
 * Migrated from the hardcoded Office board (board 5), which read the Lead Tracker
 * for lead sources, closes per week and close rates.
 *
 * ⚠ Cohort basis is leads CREATED in the window, not decided in it — matching the
 * Office board and the Board 8 close-rate widget, so the same question gets the
 * same answer wherever it's asked.
 *
 * ⚠ Close rate counts only `closed_won` + `closed_lost`. `closed_other` is junk,
 * not a loss: Bad Lead, Unreachable, Duplicate. Counting it would treat wrong
 * numbers as sales failures. The excluded count is shown rather than hidden.
 *
 * ⚠ Rates need a real denominator. Four reps showed a flawless 100% off 3–11
 * decisions before the floor went in — noise dressed as excellence, and the same
 * class of error as the competitor's 4050% close rates. Anything under 10 decided
 * shows no rate and says why, rather than vanishing from the table.
 */

import { formatCurrency } from '@/lib/format'
import type { SalesRow } from './sources'
import type { SourceBag, WidgetDef, WindowSpec } from './types'
import type { Tone, WidgetPayload } from './payloads'

/**
 * Link from a figure to the rows behind it, carrying the CURRENT window so the
 * list is the same slice the number was read in. Point-in-time drill-downs
 * ignore the dates and say so on their own page.
 */
function drillTo(report: string, key: string, win: WindowSpec, label?: string) {
  return { href: `/hub/reports/${report}/${key}?start=${win.start}&end=${win.end}`, label }
}


const salesReq = (win: WindowSpec) => ({
  source: 'sales_pipeline' as const,
  params: { start: win.start, end: win.end },
})

function sales(bag: SourceBag, win: WindowSpec): SalesRow | null {
  return bag.get<SalesRow>(salesReq(win))[0] ?? null
}

function num(v: number | string | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function rateTone(pct: number | null): Tone {
  if (pct == null) return 'neutral'
  return pct >= 70 ? 'good' : pct >= 50 ? 'warn' : 'bad'
}

/** Stage keys are stored snake_case; show them as words. */
function stageLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export const SALES_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'kpi_new_leads',
    group: 'Sales',
    title: 'New Leads',
    blurb: 'Leads that came in',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [salesReq(win)],
    metric: (bag, _cfg, win) => {
      const r = sales(bag, win)
      return {
        kind: 'kpi',
        label: 'New Leads',
        value: r ? num(r.leads).toLocaleString() : '—',
        sub: r
          ? `${win.phrase} · ${num(r.open).toLocaleString()} still open`
          : 'No leads in this period',
        drill: drillTo('sales', 'leads', win, 'See every lead'),
      }
    },
  },

  {
    type: 'kpi_close_rate',
    group: 'Sales',
    title: 'Close Rate',
    blurb: 'Share of decided leads won',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [salesReq(win)],
    metric: (bag, _cfg, win) => {
      const r = sales(bag, win)
      return {
        kind: 'kpi',
        label: 'Close Rate',
        value: r?.close_rate != null ? `${num(r.close_rate)}%` : '—',
        tone: rateTone(r?.close_rate ?? null),
        // Naming the denominator matters: it's decided leads, not all leads.
        sub: r
          ? `${num(r.won).toLocaleString()} won of ${num(r.decided).toLocaleString()} decided${num(r.excluded_junk) > 0 ? ` · ${num(r.excluded_junk)} bad or duplicate leads excluded` : ''}`
          : 'Nothing decided yet',
      }
    },
  },

  {
    type: 'kpi_won_value',
    group: 'Sales',
    title: 'Value Sold',
    blurb: 'Annual value of what closed',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [salesReq(win)],
    metric: (bag, _cfg, win) => {
      const r = sales(bag, win)
      return {
        kind: 'kpi',
        label: 'Value Sold',
        value: r ? formatCurrency(num(r.won_value)) : '—',
        tone: 'good',
        sub: r?.avg_deal != null
          ? `${num(r.won).toLocaleString()} sales · ${formatCurrency(num(r.avg_deal))} average, in annual value`
          : 'Nothing sold yet',
      }
    },
  },

  {
    type: 'kpi_time_to_close',
    group: 'Sales',
    title: 'Time to Close',
    blurb: 'How long a lead takes to become a sale',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [salesReq(win)],
    metric: (bag, _cfg, win) => {
      const r = sales(bag, win)
      const m = r?.median_days_to_close
      return {
        kind: 'kpi',
        label: 'Time to Close',
        value: m != null ? (num(m) === 0 ? 'Same day' : `${num(m)} days`) : '—',
        tone: m == null ? 'neutral' : num(m) <= 2 ? 'good' : num(m) <= 7 ? 'warn' : 'bad',
        sub: r && m != null
          ? `Typical (median) of ${num(r.close_time_sample).toLocaleString()} sales · average ${num(r.avg_days_to_close)} days`
          : 'Nothing closed yet',
      }
    },
  },

  {
    type: 'lead_funnel',
    group: 'Sales',
    title: 'Lead Funnel',
    blurb: 'Leads in, decided, won — and where they drop',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [salesReq(win)],
    metric: (bag, _cfg, win) => {
      const r = sales(bag, win)
      const leads = num(r?.leads), decided = num(r?.decided), won = num(r?.won)
      const rows = r ? [
        { label: 'Leads in', value: leads, tone: 'neutral' as Tone, detail: 'Everything that arrived' },
        {
          label: 'Decided',
          value: decided,
          tone: 'warn' as Tone,
          detail: `${num(r.open)} still open · ${num(r.excluded_junk)} bad or duplicate`,
        },
        { label: 'Won', value: won, tone: 'good' as Tone, detail: formatCurrency(num(r.won_value)) },
      ] : []
      return {
        kind: 'bars',
        title: 'Lead Funnel',
        sub: leads > 0
          ? `${win.phrase} · ${Math.round((100 * won) / leads)}% of everything that arrived ended in a sale`
          : win.phrase,
        format: 'number',
        rows,
        empty: 'No leads in this period',
      }
    },
  },

  {
    type: 'close_rate_trend',
    group: 'Sales',
    title: 'Close Rate by Month',
    blurb: 'Is conversion holding up?',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [salesReq(win)],
    metric: (bag, _cfg, win) => {
      const r = sales(bag, win)
      const rows = (r?.by_month ?? [])
        .filter(m => m.close_rate != null)
        .map(m => ({
          label: new Date(`${m.month}-15T12:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
          value: num(m.close_rate),
          tone: rateTone(num(m.close_rate)),
          detail: `${num(m.won)} won of ${num(m.decided)} decided · ${num(m.leads)} leads in`,
        }))
      return {
        kind: 'bars',
        title: 'Close Rate by Month',
        sub: `${win.phrase} · by the month the lead arrived, so recent months keep moving as leads decide`,
        format: 'percent',
        rows,
        empty: 'Nothing decided yet',
      }
    },
  },

  {
    type: 'sales_by_person',
    group: 'Sales',
    title: 'Sales by Person',
    blurb: 'Who is closing, and at what rate',
    defaultSpan: 12,
    config: {},
    sources: (_cfg, win) => [salesReq(win)],
    metric: (bag, _cfg, win) => {
      const r = sales(bag, win)
      const floor = num(r?.rate_min_sample) || 10
      const rows = (r?.by_salesperson ?? []).map(p => ({
        key: p.name,
        cells: {
          name: p.name,
          leads: num(p.leads),
          won: num(p.won),
          decided: num(p.decided),
          rate: p.close_rate != null ? num(p.close_rate) : null,
          value: num(p.value),
        },
        tones: p.close_rate != null ? { rate: rateTone(num(p.close_rate)) } : undefined,
        // Say why a rate is blank instead of leaving an unexplained gap.
        meta: p.close_rate == null && num(p.decided) > 0
          ? { text: `Only ${num(p.decided)} decided — too few to rate fairly`, tone: 'unknown' as Tone }
          : p.name === 'Unassigned'
            ? { text: 'Leads with no salesperson on them', tone: 'bad' as Tone }
            : undefined,
      }))
      return {
        kind: 'table',
        title: 'Sales by Person',
        sub: win.phrase,
        columns: [
          { key: 'name', label: 'Salesperson', align: 'left' },
          { key: 'leads', label: 'Leads', align: 'right', format: 'number' },
          { key: 'decided', label: 'Decided', align: 'right', format: 'number' },
          { key: 'won', label: 'Won', align: 'right', format: 'number', sortable: true },
          { key: 'rate', label: 'Close rate', align: 'right', format: 'percent' },
          { key: 'value', label: 'Value sold', align: 'right', format: 'currency', sortable: true },
        ],
        rows,
        foot: `Close rate is shown only where at least ${floor} leads have been decided — a perfect score off a handful of leads says nothing, and publishing it would flatter whoever happened to get an easy run.`,
        empty: 'No leads in this period',
      }
    },
  },

  {
    type: 'sales_by_source',
    group: 'Sales',
    title: 'Close Rate by Lead Source',
    blurb: 'Which sources actually convert',
    defaultSpan: 6,
    config: {
      topN: { kind: 'number', label: 'Show top', def: 8, min: 3, max: 20, unit: 'sources' },
    },
    sources: (_cfg, win) => [salesReq(win)],
    metric: (bag, cfg, win) => {
      const r = sales(bag, win)
      const rows = (r?.by_source ?? [])
        .filter(s => s.close_rate != null)
        .sort((a, b) => num(b.close_rate) - num(a.close_rate))
        .slice(0, Number(cfg.topN))
        .map(s => ({
          label: s.source,
          value: num(s.close_rate),
          tone: rateTone(num(s.close_rate)),
          detail: `${num(s.won)} of ${num(s.decided)} decided · ${formatCurrency(num(s.value))}`,
        }))
      const thin = (r?.by_source ?? []).filter(s => s.close_rate == null).length
      return {
        kind: 'bars',
        title: 'Close Rate by Lead Source',
        sub: `${win.phrase} · sources with enough decided leads to rate`,
        format: 'percent',
        rows,
        legend: thin > 0 ? [{ label: `${thin} sources had too few leads to rate`, tone: 'unknown' as Tone }] : undefined,
        empty: 'Not enough decided leads to compare sources',
      }
    },
  },

  {
    type: 'lost_reasons',
    group: 'Sales',
    title: 'Why Leads Are Lost',
    blurb: 'Where the funnel leaks',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [salesReq(win)],
    metric: (bag, _cfg, win) => {
      const r = sales(bag, win)
      const rows = (r?.lost_reasons ?? []).map(l => ({
        label: l.reason,
        value: num(l.count),
        tone: 'bad' as Tone,
      }))
      const top = (r?.lost_reasons ?? [])[0]
      const totalLost = (r?.lost_reasons ?? []).reduce((s, l) => s + num(l.count), 0)
      return {
        kind: 'bars',
        title: 'Why Leads Are Lost',
        sub: `${win.phrase} · ${num(r?.lost).toLocaleString()} lost leads`,
        format: 'number',
        rows,
        // When one bucket swallows the answer, the reporting is the finding.
        legend: top && totalLost > 0 && num(top.count) / totalLost > 0.7 && /other|not given/i.test(top.reason)
          ? [{ label: `"${top.reason}" covers ${Math.round((100 * num(top.count)) / totalLost)}% of losses — the reasons aren't being recorded specifically enough to act on`, tone: 'unknown' as Tone }]
          : undefined,
        empty: 'No lost leads in this period',
      }
    },
  },

  {
    type: 'open_pipeline',
    group: 'Sales',
    title: 'Open Pipeline',
    blurb: 'Leads still waiting on a decision',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [salesReq(win)],
    metric: (bag, _cfg, win) => {
      const r = sales(bag, win)
      const parts = (r?.open_by_stage ?? []).map(o => ({
        label: stageLabel(o.stage),
        value: num(o.count),
        tone: (o.stage === 'current' ? 'good' : o.stage === 'appointment_set' ? 'warn' : 'neutral') as Tone,
      }))
      return {
        kind: 'donut',
        title: 'Open Pipeline',
        sub: `${num(r?.open).toLocaleString()} leads still open from ${win.phrase}`,
        parts,
        note: 'These are leads that have not been won or lost yet. Anything sitting in long-term follow-up has effectively stalled — worth a decision either way rather than leaving it open.',
        empty: 'No open leads',
      }
    },
  },

  {
    type: 'sales_insights',
    group: 'Sales',
    title: 'What the Numbers Say',
    blurb: 'Plain-language read of the funnel',
    defaultSpan: 12,
    config: {},
    sources: (_cfg, win) => [salesReq(win)],
    metric: (bag, _cfg, win) => {
      const r = sales(bag, win)
      const items: string[] = []

      if (!r || num(r.leads) === 0) {
        return { kind: 'list', title: 'What the Numbers Say', sub: '', items: [], empty: `No leads arrived ${win.phrase}` }
      }

      items.push(`${num(r.leads).toLocaleString()} leads arrived ${win.phrase}. ${num(r.won).toLocaleString()} became sales worth ${formatCurrency(num(r.won_value))} a year, ${num(r.lost).toLocaleString()} were lost, and ${num(r.open).toLocaleString()} are still open.`)

      if (r.close_rate != null) {
        items.push(`Close rate is ${num(r.close_rate)}% of decided leads. ${num(r.excluded_junk).toLocaleString()} bad or duplicate leads are left out of that entirely — counting wrong numbers as lost sales would make the team look worse than they are.`)
      }

      if (r.median_days_to_close != null) {
        items.push(`Leads close ${num(r.median_days_to_close) === 0 ? 'the same day they arrive' : `in about ${num(r.median_days_to_close)} days`} typically. That is fast, and it is the strongest argument for answering the phone — see the Communications report.`)
      }

      // The unassigned bucket is usually the biggest single recoverable loss.
      const unassigned = (r.by_salesperson ?? []).find(p => p.name === 'Unassigned')
      if (unassigned && num(unassigned.leads) > 5 && unassigned.close_rate != null) {
        items.push(`⚠ ${num(unassigned.leads).toLocaleString()} leads have no salesperson on them, and they close at ${num(unassigned.close_rate)}% against ${num(r.close_rate)}% overall. Leads nobody owns do not get worked — that gap is the cheapest thing on this page to fix.`);
      }

      const rated = (r.by_salesperson ?? []).filter(p => p.close_rate != null && p.name !== 'Unassigned')
      if (rated.length >= 2) {
        const best = [...rated].sort((a, b) => num(b.close_rate) - num(a.close_rate))[0]
        items.push(`${best.name} has the strongest close rate at ${num(best.close_rate)}% across ${num(best.decided)} decided leads.`)
      }

      const topLost = (r.lost_reasons ?? [])[0]
      const totalLost = (r.lost_reasons ?? []).reduce((s, l) => s + num(l.count), 0)
      if (topLost && totalLost > 0 && num(topLost.count) / totalLost > 0.7 && /other|not given/i.test(topLost.reason)) {
        items.push(`⚠ ${Math.round((100 * num(topLost.count)) / totalLost)}% of losses are filed as "${topLost.reason}", which does not say anything you can act on. Tightening the reasons on the Lead Tracker would turn this chart into a list of fixable problems.`)
      }

      if (num(r.attempts_leads) > 0 && num(r.leads) > 0) {
        const pct = Math.round((100 * num(r.attempts_leads)) / num(r.leads))
        if (pct < 40) {
          items.push(`Contact attempts are only logged on ${pct}% of leads (${num(r.attempts_leads)} of ${num(r.leads).toLocaleString()}), so how many touches it takes to convert cannot be measured yet. Logging attempts consistently would make speed-to-first-contact reportable.`)
        }
      }

      return { kind: 'list', title: 'What the Numbers Say', sub: `Read of ${win.phrase}`, items }
    },
  },
]

/** The arrangement Report §8.2 ships with. */
export const SALES_REPORT_PRESET: { type: string; span: number }[] = [
  { type: 'kpi_new_leads', span: 3 },
  { type: 'kpi_close_rate', span: 3 },
  { type: 'kpi_won_value', span: 3 },
  { type: 'kpi_time_to_close', span: 3 },
  { type: 'sales_insights', span: 12 },
  { type: 'lead_funnel', span: 6 },
  { type: 'close_rate_trend', span: 6 },
  { type: 'sales_by_person', span: 12 },
  { type: 'sales_by_source', span: 6 },
  { type: 'lost_reasons', span: 6 },
  { type: 'open_pipeline', span: 6 },
]
