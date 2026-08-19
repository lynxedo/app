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
/* The bucket maths, the trailing-window control and the stacked-bar assembly are
 * imported from the visit-revenue trend rather than reimplemented. Ben asked for
 * this card to work "like the Visit Revenue by Technician" — sharing the actual
 * code is the only way that stays true as either card changes. */
import {
  TREND_CONFIG, rankKeys, spansMoreThanOneYear, stackRows, toneFor, trendWindow, windowPhrase,
} from './revenuetrend'
import type { SalesPersonTrendRow } from './sources'
import { keepPerson, peopleField, peoplePhrase, personFilter, withPeople, withPeopleTitle } from './people-filter'

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
        judged: true,
        /* Naming the denominator matters: it's decided leads, not all leads.
         * ⚠ And the numerator is `competed_won`, NOT `won` — `won` now includes the
         * stages marked "counts as a sale" (Heroes: Upsells) while `decided` does not,
         * so pairing those two could print "464 won of 549 decided", or on one rep's
         * row a numerator larger than its denominator. Upsells are reported on their
         * own line below rather than folded into a rate they never competed in. */
        sub: r
          ? [
              `${num(r.competed_won).toLocaleString()} won of ${num(r.decided).toLocaleString()} decided`,
              ...(num(r.upsold) > 0 ? [`${num(r.upsold)} upsell${num(r.upsold) === 1 ? '' : 's'} sold outside this rate`] : []),
              ...(num(r.excluded_junk) > 0 ? [`${num(r.excluded_junk)} bad or duplicate leads excluded`] : []),
            ].join(' · ')
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
        /* `won` is the right basis here — this card IS "what did we sell". The split
         * is named because the figure moved when upsells started counting: Heroes'
         * 2026 YTD went from $202,753.71 to $234,294.24. */
        sub: r?.avg_deal != null
          ? [
              `${num(r.won).toLocaleString()} sales · ${formatCurrency(num(r.avg_deal))} average, in annual value`,
              ...(num(r.upsold) > 0 ? [`includes ${num(r.upsold)} upsell${num(r.upsold) === 1 ? '' : 's'} worth ${formatCurrency(num(r.upsold_value))}`] : []),
            ].join(' · ')
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
        judged: true,
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
          // ⚠ competed_won, not won: see kpi_close_rate above.
          detail: `${num(m.competed_won)} won of ${num(m.decided)} decided · ${num(m.leads)} leads in`,
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
    config: { people: peopleField('lead_salespeople', 'people') },
    sources: (_cfg, win) => [salesReq(win)],
    metric: (bag, cfg, win) => {
      const r = sales(bag, win)
      const f = personFilter(cfg)
      const floor = num(r?.rate_min_sample) || 10
      /* ⚠ 'Unassigned' is a real row here (74 leads on Heroes' book, closing at 3.2%),
       * so it is filterable like anyone else — ticking it alone answers "how are the
       * leads nobody owns doing", which is the cheapest fix on the page. */
      const rows = (r?.by_salesperson ?? []).filter(p => keepPerson(f, p.name, p.name)).map(p => ({
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
        title: withPeopleTitle('Sales by Person', f),
        sub: withPeople(win.phrase, f),
        columns: [
          { key: 'name', label: 'Salesperson', align: 'left' },
          { key: 'leads', label: 'Leads', align: 'right', format: 'number' },
          { key: 'decided', label: 'Decided', align: 'right', format: 'number' },
          // "Sold", not "Won": includes any stage marked as counting as a sale, which
          // is why it can exceed Decided on a rep with upsells.
          { key: 'won', label: 'Sold', align: 'right', format: 'number', sortable: true, title: 'Deals sold, including upsells if your Lead Tracker counts them as sales' },
          { key: 'rate', label: 'Close rate', align: 'right', format: 'percent' },
          { key: 'value', label: 'Value sold', align: 'right', format: 'currency', sortable: true },
        ],
        rows,
        foot: `Close rate is shown only where at least ${floor} leads have been decided — a perfect score off a handful of leads says nothing, and publishing it would flatter whoever happened to get an easy run.`,
        empty: f.active ? 'No leads for these people in this period' : 'No leads in this period',
      }
    },
  },

  {
    type: 'sales_by_person_trend',
    group: 'Sales',
    title: 'Sales by Person over Time',
    blurb: 'Stacked by salesperson, month by month or week by week',
    defaultSpan: 12,
    /**
     * The chart version of "Sales by Person".
     *
     * Ben: "let's add a different version widget. Make it like the Visit Revenue by
     * Technician where it is a bar graph and we can choose either board time frame
     * or trailing X weeks/months."
     *
     * ⚠ A SEPARATE WIDGET rather than a display toggle on the table. The table
     * answers "how is each rep doing over this window", including close rate, which
     * has no sensible per-month reading at Heroes' volume — several reps decide
     * fewer than the fair-rating floor in a single month, so a monthly close-rate
     * series would be mostly blanks. This card drops the rate and shows what is
     * additive over time: value sold, or the number of sales.
     *
     * ⚠⚠ UNLIKE Visit Revenue by Technician, THESE BARS ADD UP. That chart credits a
     * two-person visit to both technicians, so its segments total above company
     * revenue; a lead has exactly one salesperson, so nothing here is counted twice.
     * Verified against the Sales report over Heroes' 2026 book: the segments, the
     * period totals and `won_value` all come to $234,919.24 on 468 sales.
     */
    config: {
      ...TREND_CONFIG,
      show: {
        kind: 'enum' as const,
        label: 'Show',
        def: 'Value sold',
        opts: ['Value sold', 'Number of sales'],
      },
      top: { kind: 'number' as const, label: 'Show top', def: 8, min: 3, max: 15, unit: 'salespeople' },
      people: peopleField('lead_salespeople', 'people'),
    },
    sources: (cfg, win) => {
      const w = trendWindow(cfg, win)
      return [{ source: 'sales_person_trend' as const, params: { start: w.start, end: w.end, grain: w.grain } }]
    },
    metric: (bag, cfg, win) => {
      const w = trendWindow(cfg, win)
      const r = bag.get<SalesPersonTrendRow>({
        source: 'sales_person_trend', params: { start: w.start, end: w.end, grain: w.grain },
      })[0] ?? null
      const byCount = String(cfg.show) === 'Number of sales'
      const f = personFilter(cfg)

      const periods = (r?.periods ?? []).map(p => ({ b: p.b, total: byCount ? num(p.count) : num(p.total) }))
      /* ⚠ Filtered in the metric, never in the query — so this card and an unfiltered
       * one on the same board share ONE round trip, and the filter can only ever
       * remove rows the viewer was already sent. 'Unassigned' is a real row and stays
       * filterable like anyone else. */
      const people = (r?.people ?? [])
        .filter(p => keepPerson(f, p.name, p.name))
        .map(p => ({ b: p.b, k: p.k, name: p.name, total: byCount ? num(p.count) : num(p.total) }))

      const keys = rankKeys(people, Math.max(3, Math.min(15, Number(cfg.top) || 8)))
      const spans = spansMoreThanOneYear(periods)
      const names = new Map<string, string>()
      for (const p of people) if (!names.has(p.k)) names.set(p.k, p.name)

      const fmt = byCount
        ? (n: number) => Math.round(n).toLocaleString()
        : (n: number) => `$${Math.round(n).toLocaleString()}`

      const notes: string[] = [byCount ? 'deals sold' : 'annual value sold']
      /* ⚠ Same cohort as every other Sales card: leads are counted in the month they
       * were CREATED, not the month they closed. Said on the card because a bar chart
       * over time invites the other reading — a deal created in March and sold in
       * June sits in March. */
      notes.push('counted in the month the lead came in, not the month it closed')
      // The filter states itself, the same way every other filtered card does.
      const only = peoplePhrase(f)
      if (only) notes.push(only)

      return {
        kind: 'stacked',
        format: 'currency',
        title: withPeopleTitle('Sales by Person over Time', f),
        sub: `${windowPhrase(w, cfg, periods.length)} · ${notes.join(' · ')}`,
        // ⚠ Magnitude, not normalised: a $12k month and a $60k month must not draw
        // the same height, which is the whole point of putting sales on a time axis.
        scale: 'magnitude',
        rows: stackRows(periods, people, keys, k => names.get(k) ?? k, w.grain, spans, fmt),
        legend: keys.map(k => ({ label: names.get(k) ?? k, tone: toneFor(k, keys) })),
        empty: f.active ? 'No sales for these people in this period' : 'No sales in this period',
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
          // ⚠ competed_won, not won: the rate this sits beside is competed-only.
          detail: `${num(s.competed_won)} of ${num(s.decided)} decided · ${formatCurrency(num(s.value))}`,
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
  {
    type: 'sales_new_vs_upsell',
    group: 'Sales',
    title: 'New Business vs Upsells',
    blurb: 'How much of what you sold was a new customer and how much was an upgrade',
    defaultSpan: 6,
    /**
     * The old Main board's "Upsells vs New Sales by Month" card, which had no widget.
     *
     * ⚠ Which stages count as an upsell is NOT set here — it comes from
     * `counts_as_sale` on the Lead Tracker stages, so this card, Value Sold, Open
     * Pipeline and every per-person figure all agree by construction. A card-level
     * setting would let one board disagree with another about what a sale is.
     */
    config: {
      measure: {
        kind: 'enum' as const,
        label: 'Measure by',
        def: 'Annual value',
        opts: ['Annual value', 'How many'],
      },
    },
    sources: (_cfg, win) => [salesReq(win)],
    metric: (bag, cfg, win) => {
      const r = sales(bag, win)
      const byValue = String(cfg.measure) === 'Annual value'
      const stages = r?.sale_stages ?? []
      const months = r?.by_month ?? []
      const rows = months.map(m => {
        const nw = byValue ? num(m.competed_value) : num(m.competed_won)
        const up = byValue ? num(m.upsold_value) : num(m.upsold)
        return {
          label: new Date(`${m.month}-15T12:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
          caption: byValue ? formatCurrency(nw + up) : String(nw + up),
          parts: [
            { value: Math.round(nw), tone: 'good' as Tone, label: 'New business' },
            { value: Math.round(up), tone: 'mixed' as Tone, label: 'Upsells' },
          ],
        }
      })
      return {
        kind: 'stacked',
        format: 'currency',
        title: 'New Business vs Upsells',
        // ⚠ 'magnitude', not the default 'share': normalising every month to 100%
        // would answer "what was the mix" while hiding that one month sold twice as
        // much as another, which is half the question here.
        scale: 'magnitude',
        sub: stages.length
          ? `${win.phrase} · by the month the lead arrived · upsells are the ${stages.join(', ')} stage${stages.length === 1 ? '' : 's'}`
          : `${win.phrase} · no Lead Tracker stage is marked as counting as a sale, so everything here is new business`,
        rows,
        legend: [
          { label: 'New business', tone: 'good' as Tone },
          { label: 'Upsells', tone: 'mixed' as Tone },
        ],
        empty: 'No leads in this period',
      }
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
