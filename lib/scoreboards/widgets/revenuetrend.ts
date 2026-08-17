/* Visit revenue over time — company, by service line, by technician.
 *
 * The gap these fill: the catalog could say what each service line earned across a
 * whole window (§8.8) and what was invoiced month by month (§8.3), but nothing
 * showed what the crews actually PRODUCED as a trend, broken down.
 *
 * ⚠⚠ THIS IS VISIT REVENUE, NOT INVOICED MONEY. It is rebuilt from Jobber line
 * items on completed visits — `visits.total` is NULL on every one of them — using
 * rules copied verbatim from `scoreboard_techs_revenue`. It will NOT tie to
 * "Invoiced vs Collected by Month" on the Revenue report, because that measures
 * money billed and this measures work done. Every card below says so on its face,
 * because two money-per-month charts that disagree are worse than one.
 *
 * All three widgets share ONE source, parameterised by grain, so a board carrying
 * the monthly and weekly views of the same cut costs two queries rather than six.
 */

import type { RevenueTrendRow } from './sources'
import type { SourceBag, SourceRequest, WidgetConfig, WidgetDef, WindowSpec } from './types'
import type { Tone, WidgetPayload } from './payloads'
import { NO_TECH, keepPerson, peopleField, peoplePhrase, personFilter } from './people-filter'
import { formatCurrency } from '@/lib/format'
// Same code→name map the Service Line report uses, so "MO" never appears on one
// screen while "Mosquito" appears on another.
import { lineName } from './servicelines'

/* ── window maths ────────────────────────────────────────────────────────────
 *
 * Pure string arithmetic anchored on `win.end` — never `new Date()`. A source
 * declaration must be a pure function of (cfg, window) or the resolver's dedupe
 * key stops matching what actually runs, and a clock read would also make the
 * same board disagree with itself between two requests.
 */

const DAY = 86_400_000
const asUTC = (d: string) => Date.parse(`${d}T00:00:00Z`)
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Monday of the week containing `d`. Postgres `date_trunc('week')` starts Monday,
 *  and so does the Mon–Sun week `scoreboard_crew_labor` uses for overtime. */
function weekStart(d: string): string {
  const ms = asUTC(d)
  const dow = new Date(ms).getUTCDay()          // 0=Sun … 6=Sat
  const backToMonday = (dow + 6) % 7
  return iso(ms - backToMonday * DAY)
}

function monthStart(d: string): string {
  return `${d.slice(0, 7)}-01`
}

function shiftMonths(firstOfMonth: string, by: number): string {
  const y = Number(firstOfMonth.slice(0, 4))
  const m = Number(firstOfMonth.slice(5, 7))
  const total = y * 12 + (m - 1) + by
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

export type Grain = 'month' | 'week'

/**
 * The window a trend widget actually measures.
 *
 * ⚠ "Trailing N" is anchored on the page window's END, not on today. That keeps
 * the function pure, and it behaves sensibly either way: with the page on
 * year-to-date (end = today) "trailing 6 weeks" is the last six weeks, and with
 * the page on last month it is the six weeks ending then. The card prints the
 * dates it used, so it can never quietly measure something other than its label.
 *
 * ⚠ Snapped to bucket starts. Asking for "six weeks back from today" spans SEVEN
 * partial calendar weeks — measured against the live book — so the start is moved
 * to the Monday of the (N-1)th week back, giving exactly N bars with the current
 * one partial.
 */
export function trendWindow(cfg: WidgetConfig, win: WindowSpec): { start: string; end: string; grain: Grain } {
  const grain: Grain = String(cfg.grain) === 'Week' ? 'week' : 'month'
  if (String(cfg.window) !== 'Trailing periods') {
    return { start: win.start, end: win.end, grain }
  }
  const n = Math.max(2, Math.min(26, Number(cfg.periods) || 6))
  const start = grain === 'week'
    ? iso(asUTC(weekStart(win.end)) - (n - 1) * 7 * DAY)
    : shiftMonths(monthStart(win.end), -(n - 1))
  return { start, end: win.end, grain }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A bucket's axis label. Weeks read as their Monday; months gain a year when the chart spans one. */
function bucketLabel(b: string, grain: Grain, spansYears: boolean): string {
  const y = b.slice(0, 4)
  const m = Number(b.slice(5, 7))
  const d = Number(b.slice(8, 10))
  if (grain === 'week') return `${MONTHS[m - 1]} ${d}`
  return spansYears ? `${MONTHS[m - 1]} ${y.slice(2)}` : MONTHS[m - 1]
}

function windowPhrase(w: { start: string; end: string; grain: Grain }, cfg: WidgetConfig, count: number): string {
  const unit = w.grain === 'week' ? 'week' : 'month'
  if (String(cfg.window) === 'Trailing periods') {
    return `Trailing ${count} ${unit}${count === 1 ? '' : 's'} to ${bucketLabel(w.end, 'week', false)}`
  }
  return `By ${unit}`
}

/* ── shared plumbing ─────────────────────────────────────────────────────── */

/**
 * Narrow the money to one or more service lines.
 *
 * ⚠ Added to the company total and the by-line chart, deliberately NOT to
 * TREND_CONFIG itself — the per-technician chart is about people, and silently
 * gaining a line filter would change what its bars mean without its title moving.
 *
 * ⚠ Filtered in the METRIC, never pushed into the query, for the same reason the
 * person filter is: a WF card and a PW card on one board then share ONE round trip.
 * It also means the filter can only ever remove buckets the viewer was already sent.
 */
const LINE_FILTER = {
  kind: 'catalog' as const,
  label: 'Only these service lines',
  def: [] as string[],
  catalog: 'service_lines' as const,
  hint: 'Leave every box unticked for the whole company.',
}

const asArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : []

/** Per-bucket totals for just the selected lines. Empty selection → null (= use the
 *  company total, which is what the source already hands us). */
function bucketTotalsForLines(
  r: RevenueTrendRow | null,
  cfg: WidgetConfig,
): Map<string, number> | null {
  const sel = new Set(asArray(cfg.lines))
  if (!sel.size) return null
  const out = new Map<string, number>()
  for (const l of r?.lines ?? []) {
    if (sel.has(l.k)) out.set(l.b, (out.get(l.b) ?? 0) + num(l.total))
  }
  return out
}

function linePhrase(cfg: WidgetConfig): string | null {
  const sel = asArray(cfg.lines)
  return sel.length ? sel.map(lineName).join(' + ') : null
}

const TREND_CONFIG = {
  grain: { kind: 'enum' as const, label: 'Bucket by', def: 'Month', opts: ['Month', 'Week'] },
  window: {
    kind: 'enum' as const,
    label: 'Period shown',
    def: 'Follow the page range',
    opts: ['Follow the page range', 'Trailing periods'],
    hint: 'Trailing ignores the date picker above — use it to pin “the last 6 weeks”.',
  },
  periods: {
    kind: 'number' as const, label: 'How many', def: 6, min: 2, max: 26, unit: 'periods',
    hint: 'Only used when “Period shown” is Trailing.',
  },
}

function trendReq(cfg: WidgetConfig, win: WindowSpec, credit: 'each' | 'split' = 'each'): SourceRequest {
  const w = trendWindow(cfg, win)
  return {
    source: 'visit_revenue_trend',
    params: { start: w.start, end: w.end, grain: w.grain, tech_credit: credit },
  }
}

function trend(bag: SourceBag, cfg: WidgetConfig, win: WindowSpec, credit: 'each' | 'split' = 'each'): RevenueTrendRow | null {
  return bag.get<RevenueTrendRow>(trendReq(cfg, win, credit))[0] ?? null
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

/**
 * Colour per category, stable across buckets.
 *
 * ⚠ Assigned from a sorted key list, NOT from each bucket's own ordering — a
 * stacked chart whose colours reshuffle between bars is unreadable, and worse,
 * quietly misleading.
 */
const SERIES_TONES: Tone[] = ['good', 'warn', 'mixed', 'neutral', 'bad', 'unknown', 'free', 'paid']

function toneFor(key: string, ordered: string[]): Tone {
  const i = ordered.indexOf(key)
  return SERIES_TONES[(i < 0 ? 0 : i) % SERIES_TONES.length]
}

/**
 * Categories ranked by total across the whole window, biggest first.
 *
 * ⚠ Zero-total keys are dropped. Heroes' book has a Jobber user assigned to visits
 * that carry no line items, so it arrives with $0 for the period — kept, it would
 * take a legend swatch and a colour while drawing no bar, which reads as a bug.
 */
function rankKeys(rows: { k: string; total: number }[], limit?: number): string[] {
  const sums = new Map<string, number>()
  for (const r of rows) sums.set(r.k, (sums.get(r.k) ?? 0) + num(r.total))
  const ordered = [...sums.entries()]
    .filter(([, v]) => v > 0.5)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
  return limit ? ordered.slice(0, limit) : ordered
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`

/**
 * Build the stacked rows shared by the by-line and by-tech charts.
 *
 * Anything outside the top-N is folded into one "Everyone else" band rather than
 * dropped, so the bar heights still equal the period totals. A chart that silently
 * omits the tail reads as a shrinking business.
 */
function stackRows(
  periods: { b: string; total: number }[],
  parts: { b: string; k: string; total: number }[],
  keys: string[],
  labelFor: (k: string) => string,
  grain: Grain,
  spansYears: boolean,
) {
  const byBucket = new Map<string, Map<string, number>>()
  for (const p of parts) {
    const m = byBucket.get(p.b) ?? new Map<string, number>()
    m.set(p.k, (m.get(p.k) ?? 0) + num(p.total))
    byBucket.set(p.b, m)
  }
  const keySet = new Set(keys)
  return periods.map(p => {
    const m = byBucket.get(p.b) ?? new Map<string, number>()
    const named = keys.map(k => ({ value: Math.round(num(m.get(k))), tone: toneFor(k, keys), label: labelFor(k) }))
    let rest = 0
    for (const [k, v] of m) if (!keySet.has(k)) rest += num(v)
    if (rest > 0.5) named.push({ value: Math.round(rest), tone: 'unknown' as Tone, label: 'Everyone else' })
    // ⚠ Caption is the SUM OF THE SEGMENTS, not the period's company total. For
    // the by-line chart they are identical (verified to the cent). For the
    // by-tech chart with shared visits credited to each tech they are not, and a
    // number printed beside a bar has to be that bar's number — otherwise the
    // label silently contradicts the length it sits next to.
    const drawn = named.reduce((s, x) => s + x.value, 0)
    return { label: bucketLabel(p.b, grain, spansYears), caption: money(drawn), parts: named }
  })
}

function spansMoreThanOneYear(periods: { b: string }[]): boolean {
  if (periods.length < 2) return false
  return periods[0].b.slice(0, 4) !== periods[periods.length - 1].b.slice(0, 4)
}

/* ── the widgets ─────────────────────────────────────────────────────────── */

export const REVENUE_TREND_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'visit_revenue_trend',
    // Grouped under Revenue, so it answers to the Revenue & Invoicing grant — the
    // report that already shows company money over time.
    group: 'Revenue',
    title: 'Visit Revenue by Period',
    blurb: 'What the crews produced, month by month or week by week',
    defaultSpan: 6,
    config: { ...TREND_CONFIG, lines: LINE_FILTER },
    sources: (cfg, win) => [trendReq(cfg, win)],
    metric: (bag, cfg, win) => {
      const r = trend(bag, cfg, win)
      const periods = r?.periods ?? []
      const spans = spansMoreThanOneYear(periods)
      const w = trendWindow(cfg, win)
      const only = linePhrase(cfg)
      const perLine = bucketTotalsForLines(r, cfg)
      return {
        kind: 'bars',
        title: only ? `Visit Revenue — ${only}` : 'Visit Revenue by Period',
        // Says what it is measuring, every time. The Revenue report has a monthly
        // chart of INVOICED money and the two will not tie.
        sub: [
          windowPhrase(w, cfg, periods.length),
          'completed work, not invoices',
          ...(only ? [`${only} only`] : []),
        ].join(' · '),
        format: 'currency',
        rows: periods.map(p => ({
          label: bucketLabel(p.b, w.grain, spans),
          value: Math.round(perLine ? num(perLine.get(p.b)) : num(p.total)),
          tone: 'good' as Tone,
          /* ⚠ The visit count is dropped once a line filter is on. Visits are not
           * split per line in the payload, so it would be the COMPANY's visit count
           * sitting next to one line's dollars — a caption quietly contradicting the
           * bar it labels. Absent beats wrong. */
          detail: perLine
            ? undefined
            : `${num(p.visits).toLocaleString()} visit${num(p.visits) === 1 ? '' : 's'}`,
        })),
        empty: only
          ? `No completed ${only} visits in this period`
          : 'No completed visits in this period',
      }
    },
  },

  {
    type: 'visit_revenue_by_line',
    // The service-line cut of the same money → answers to the Service Line
    // Profitability grant, which is where department revenue already lives.
    group: 'Service Lines',
    title: 'Visit Revenue by Service Line',
    blurb: 'Stacked by department, month by month or week by week',
    defaultSpan: 12,
    config: { ...TREND_CONFIG, lines: LINE_FILTER },
    sources: (cfg, win) => [trendReq(cfg, win)],
    metric: (bag, cfg, win) => {
      const r = trend(bag, cfg, win)
      const periods = r?.periods ?? []
      const sel = new Set(asArray(cfg.lines))
      const lines = sel.size ? (r?.lines ?? []).filter(l => sel.has(l.k)) : (r?.lines ?? [])
      const w = trendWindow(cfg, win)
      const keys = rankKeys(lines)
      const spans = spansMoreThanOneYear(periods)
      const only = linePhrase(cfg)
      return {
        kind: 'stacked',
        title: only ? `Visit Revenue — ${only}` : 'Visit Revenue by Service Line',
        // The by-line series is computed at visit level with no technician
        // fan-out, so these bars sum EXACTLY to the company total — verified to
        // the cent. That is why this one carries no caveat and the tech one does.
        // ⚠ Once filtered they no longer add up to the company total, and saying so
        // is the point: the claim on the card has to stay true of the card.
        sub: [
          windowPhrase(w, cfg, periods.length),
          only ? `${only} only — not the company total` : 'adds up to total visit revenue',
        ].join(' · '),
        scale: 'magnitude',
        rows: stackRows(periods, lines, keys, lineName, w.grain, spans),
        legend: keys.map(k => ({ label: lineName(k), tone: toneFor(k, keys) })),
        empty: only
          ? `No completed ${only} visits in this period`
          : 'No completed visits in this period',
      }
    },
  },

  {
    type: 'visit_revenue_by_tech',
    // Per-technician production → answers to the Crew & Labor grant, the same
    // audience as "Revenue per Hour by Technician".
    group: 'Crew & Labor',
    title: 'Visit Revenue by Technician',
    blurb: 'Stacked by tech, month by month or week by week',
    defaultSpan: 12,
    config: {
      ...TREND_CONFIG,
      top: { kind: 'number' as const, label: 'Show top', def: 8, min: 3, max: 15, unit: 'technicians' },
      people: peopleField('jobber_people', 'technicians'),
      shared: {
        kind: 'enum' as const,
        label: 'Visits with two techs',
        def: 'Credit each tech',
        opts: ['Credit each tech', 'Split between them'],
        hint: 'Crediting each matches the technician boards; splitting makes the bars add up to company revenue.',
      },
    },
    sources: (cfg, win) => [trendReq(cfg, win, String(cfg.shared) === 'Split between them' ? 'split' : 'each')],
    metric: (bag, cfg, win) => {
      const credit = String(cfg.shared) === 'Split between them' ? 'split' : 'each'
      const r = trend(bag, cfg, win, credit)
      const periods = r?.periods ?? []
      const w = trendWindow(cfg, win)
      const filter = personFilter(cfg)
      /* ⚠ Filtered in the metric, so a card for one tech and the whole-team card
       * share ONE query. Filtering to a subset also means the bars no longer sum to
       * company revenue — but that was already true of this chart when crediting each
       * tech, and the subtitle states the filter, so the bar labels stay the truth
       * about themselves. */
      const techs = (r?.techs ?? []).filter(t => keepPerson(filter, t.name, NO_TECH))
      const keys = rankKeys(techs, Math.max(3, Math.min(15, Number(cfg.top) || 8)))
      const spans = spansMoreThanOneYear(periods)
      const names = new Map<string, string>()
      for (const t of techs) if (!names.has(t.k)) names.set(t.k, t.name)

      /* ⚠ The honesty line, and the reason this widget exists in this shape.
       * With 'Credit each tech', a visit worked by two people credits BOTH, so the
       * bars total MORE than company revenue — measured at $16,331 (3.8%) across
       * 20 visits on Heroes' 2026 book, because shared visits are the big
       * irrigation tickets. Stated in dollars rather than left for someone to
       * discover by adding the segments up. Silent when there is no overlap. */
      const overlap = num(r?.shared_overlap)
      const sharedVisits = num(r?.shared_visits)
      const unattributed = num(r?.unattributed_revenue)
      const notes: string[] = []
      /* ⚠⚠ Both figures below are COMPANY-WIDE, so neither may be printed on a
       * filtered card: "$16,331 above company revenue" is a statement about all
       * twenty technicians and would be simply false beneath one person's bars. The
       * filter itself is stated instead — a caveat that no longer applies is worse
       * than no caveat, because it reads as though it were measured for this card. */
      const only = peoplePhrase(filter)
      if (only) notes.push(only)
      if (!filter.active && overlap > 0.5) {
        notes.push(`${sharedVisits} visit${sharedVisits === 1 ? '' : 's'} had more than one tech and credit both, so the bars come to ${money(overlap)} above company revenue`)
      }
      // Only worth saying when unassigned work could be in this card: filtered to
      // named people it is excluded by construction, so the note would describe
      // money the chart was never asked about.
      if (unattributed > 0.5 && !filter.active) {
        notes.push(`${money(unattributed)} sits on visits with nobody assigned and appears in no column`)
      }

      return {
        kind: 'stacked',
        title: 'Visit Revenue by Technician',
        sub: `${windowPhrase(w, cfg, periods.length)}${notes.length ? ` · ${notes.join(' · ')}` : credit === 'split' ? ' · shared visits split, so this adds up to company revenue' : ''}`,
        empty: filter.active
          ? 'No completed visits for these technicians in this period'
          : 'No completed visits in this period',
        scale: 'magnitude',
        rows: stackRows(periods, techs, keys, k => names.get(k) ?? k, w.grain, spans),
        legend: keys.map(k => ({ label: names.get(k) ?? k, tone: toneFor(k, keys) })),
      }
    },
  },

  {
    type: 'kpi_visit_revenue',
    group: 'Revenue',
    title: 'Visit Revenue',
    blurb: 'One figure for the work completed — company-wide or for one service line',
    defaultSpan: 3,
    /**
     * ⚠ The gap this fills is narrow but real: EVERY other revenue KPI in the library
     * measures INVOICED money (`kpi_invoiced`, `kpi_collected`, `kpi_avg_invoice`),
     * and visit revenue existed only as a chart. The old Main board's headline tile
     * and the "WF/IR/PW Revenue YTD" tiles are all this measure, so without it those
     * boards could not be rebuilt.
     */
    config: {
      lines: LINE_FILTER,
      label: {
        kind: 'text' as const,
        label: 'Name on the card',
        def: '',
        placeholder: 'e.g. WF Revenue',
        hint: 'Leave blank and the card names the filter itself.',
      },
    },
    // Grain is irrelevant to a total but the source needs one; month is the cheaper
    // bucketing and the sum is identical either way.
    sources: (_cfg, win) => [{ source: 'visit_revenue_trend', params: { start: win.start, end: win.end, grain: 'month', tech_credit: 'each' } }],
    metric: (bag, cfg, win) => {
      const r = bag.get<RevenueTrendRow>({
        source: 'visit_revenue_trend',
        params: { start: win.start, end: win.end, grain: 'month', tech_credit: 'each' },
      })[0] ?? null
      const only = linePhrase(cfg)
      const perLine = bucketTotalsForLines(r, cfg)
      const total = perLine
        ? [...perLine.values()].reduce((s, v) => s + v, 0)
        : num(r?.total)
      const visits = (r?.periods ?? []).reduce((s, p) => s + num(p.visits), 0)
      return {
        kind: 'kpi',
        label: String(cfg.label).trim() || (only ? `${only} Revenue` : 'Visit Revenue'),
        value: formatCurrency(total),
        tone: 'good',
        sub: [
          `Completed work in ${win.phrase}`,
          'not invoices',
          // Visit counts are company-wide in the payload, so they are only quoted
          // when the figure beside them is too.
          ...(perLine ? [`${only} only`] : [`${visits.toLocaleString()} visit${visits === 1 ? '' : 's'}`]),
        ].join(' · '),
      }
    },
  },
]
