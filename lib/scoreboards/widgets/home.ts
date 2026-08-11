/* Home / Command Center widgets — the library behind Report §8.1.
 *
 * Built LAST on purpose (REPORTS_PRD.md §15.0 4b). Home is an assembly of the
 * questions the other seven reports answer, so building it first would have meant
 * building all of them anyway without the pages that justify them. Most of this
 * page is therefore existing widgets arranged into a preset; only the parts that
 * genuinely don't exist elsewhere are new code.
 *
 * THREE things are new here, and each exists for a reason the other reports don't
 * cover:
 *
 *   1. DELTAS. Every other report answers "what is the number"; Home has to answer
 *      "is it getting better". The tiles below compare against the immediately
 *      preceding window of the same length — a second request to the SAME source,
 *      so the resolver batches it and no new query shape was needed.
 *
 *   2. NEEDS ATTENTION. Counts nobody should have to go looking for: work finished
 *      but never billed, visits that never happened, recurring customers with
 *      nothing on the calendar.
 *
 *   3. WORK ON THE BOOKS. Deliberately NOT called a forecast — see below.
 *
 * ⚠ THE DELTA'S DATA FLOOR IS THE TRAP THIS PAGE IS MOST EXPOSED TO. Heroes' invoice
 * mirror starts 2026-01-02. A year-to-date window compared against "the year to date
 * before it" reaches into a period we hold nothing for, and −100% is a lie that
 * looks exactly like a business collapsing. Every delta below therefore checks the
 * floor and DROPS the comparison, saying why, rather than printing a number that
 * would be read as catastrophe. This is the same discipline as the clamped crew
 * window (§8.6) and the year-labelled retention widgets (§8.5).
 *
 * ⚠ "WORK ON THE BOOKS" IS NOT A FORECAST, and the naming is the honesty. The PRD
 * asks for a six-month revenue forecast; what the data actually supports is the sum
 * of work already scheduled and already priced. That is a real, useful number — but
 * a forecast implies a model that accounts for cancellations, reschedules and work
 * not yet sold, and we have none. It is also a FLOOR, not an estimate: 250 of the
 * 1,910 scheduled visits carry no line item of their own, so their revenue is
 * missing from the total. The card says all of this rather than implying precision
 * the number doesn't have.
 */

import { formatCurrency } from '@/lib/format'
import type { ClientsRow, HomePulseRow, InvoiceArRow, InvoiceWindowRow, SalesRow } from './sources'
import type { SourceBag, WidgetConfig, WidgetDef, WindowSpec } from './types'
import { priorWindow } from './windows'
import type { Tone, WidgetPayload } from './payloads'

/* ── requests ───────────────────────────────────────────────────────────── */

const invoiceReq = (win: WindowSpec) => ({
  source: 'invoice_window' as const,
  params: { start: win.start, end: win.end },
})
const arReq = () => ({ source: 'invoice_ar' as const, params: {} })
const clientsReq = (win: WindowSpec) => ({
  source: 'clients_overview' as const,
  params: { start: win.start, end: win.end },
})
const salesReq = (win: WindowSpec) => ({
  source: 'sales_pipeline' as const,
  params: { start: win.start, end: win.end },
})
const pulseReq = (months: number) => ({
  source: 'home_pulse' as const,
  params: { months },
})

/** Current + prior window of one source — the shape every delta tile declares. */
function bothWindows<T extends { params: Record<string, string | number> }>(
  make: (w: WindowSpec) => T,
  win: WindowSpec,
): T[] {
  return [make(win), make(priorWindow(win))]
}

const one = <T,>(bag: SourceBag, req: { source: string; params: Record<string, unknown> }): T | null =>
  (bag.get<T>(req as Parameters<SourceBag['get']>[0])[0] ?? null)

/** Postgres numerics arrive as strings through PostgREST; a bare `+` concatenates. */
function num(v: number | string | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/* ── deltas ─────────────────────────────────────────────────────────────── */

type Delta = NonNullable<Extract<WidgetPayload, { kind: 'kpi' }>['delta']>

/**
 * Percent change, or an explicit refusal.
 *
 * `floor` is the earliest date the underlying data exists for. When the prior
 * window starts before it we are comparing against a period we simply don't hold,
 * so the honest output is "no comparison", never a percentage.
 */
function delta(
  current: number,
  prior: number,
  prev: WindowSpec,
  floor: string | null,
  opts: { unit?: 'currency' } = {},
): Delta | undefined {
  if (floor && prev.start < floor) {
    return { pct: null, text: `No comparison — records start ${prettyDate(floor)}`, tone: 'neutral' }
  }
  if (prior <= 0) {
    // Dividing by nothing produces either Infinity or a meaningless "+100%".
    return current > 0
      ? { pct: null, text: `Nothing to compare in ${prev.label}`, tone: 'neutral' }
      : undefined
  }
  const pct = Math.round(((current - prior) / prior) * 1000) / 10
  const flat = Math.abs(pct) < 0.5
  const arrow = flat ? '→' : pct > 0 ? '▲' : '▼'
  const shown = opts.unit === 'currency' ? formatCurrency(prior) : prior.toLocaleString()
  // ⚠ Names the prior window's actual DATES rather than calling it "last month".
  // The comparison is always the preceding window of equal length, which for an
  // 11-day month-to-date is Jul 21–31 — describing that as "last month" would be
  // wrong in a way nobody could catch from the card.
  return {
    pct,
    text: `${arrow} ${Math.abs(pct).toFixed(1)}% vs ${shown} in ${prev.label}`,
    // Every Home tile is higher-is-better (revenue, cash, customers, close rate).
    // A tile where down is good would need its own rule rather than this default.
    tone: flat ? 'neutral' : pct > 0 ? 'good' : 'bad',
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[(m || 1) - 1]} ${d}, ${y}`
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS[(m || 1) - 1]} ${String(y).slice(2)}`
}

/* ── widgets ────────────────────────────────────────────────────────────── */

export const HOME_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'home_kpi_invoiced',
    group: 'Home',
    title: 'Revenue (with trend)',
    blurb: 'Billed this period against the one before it',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => bothWindows(invoiceReq, win),
    metric: (bag, _cfg, win) => {
      const now = one<InvoiceWindowRow>(bag, invoiceReq(win))
      const prev = priorWindow(win)
      const then = one<InvoiceWindowRow>(bag, invoiceReq(prev))
      const value = num(now?.invoiced)
      return {
        kind: 'kpi',
        label: 'Invoiced',
        value: formatCurrency(value),
        sub: win.label,
        delta: delta(value, num(then?.invoiced), prev, now?.earliest_invoice ?? null, { unit: 'currency' }),
        spark: (now?.monthly ?? []).map(m => num(m.invoiced)),
      }
    },
  },

  {
    type: 'home_kpi_collected',
    group: 'Home',
    title: 'Cash Collected (with trend)',
    blurb: 'What actually came in, against the prior period',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => bothWindows(invoiceReq, win),
    metric: (bag, _cfg, win) => {
      const now = one<InvoiceWindowRow>(bag, invoiceReq(win))
      const prev = priorWindow(win)
      const then = one<InvoiceWindowRow>(bag, invoiceReq(prev))
      const value = num(now?.collected)
      return {
        kind: 'kpi',
        label: 'Cash Collected',
        value: formatCurrency(value),
        sub: win.label,
        delta: delta(value, num(then?.collected), prev, now?.earliest_invoice ?? null, { unit: 'currency' }),
        spark: (now?.monthly ?? []).map(m => num(m.collected)),
      }
    },
  },

  {
    /**
     * ⚠ No delta, deliberately. Receivables are point-in-time — there is no "AR for
     * last month" to compare against without storing history we don't keep, and a
     * fabricated comparison on the one number people chase would be worse than none.
     */
    type: 'home_kpi_ar',
    group: 'Home',
    title: 'Outstanding Right Now',
    blurb: 'What customers owe today, and how much is late',
    defaultSpan: 3,
    config: {},
    sources: () => [arReq()],
    metric: bag => {
      const ar = one<InvoiceArRow>(bag, arReq())
      const total = num(ar?.total_ar)
      const overdue = num(ar?.overdue_total)
      const share = total > 0 ? Math.round((100 * overdue) / total) : 0
      return {
        kind: 'kpi',
        label: 'Outstanding',
        value: formatCurrency(total),
        tone: overdue > 0 ? (share >= 50 ? 'bad' : 'warn') : 'good',
        sub: overdue > 0
          ? `${formatCurrency(overdue)} of it past due · as of today`
          : 'Nothing past due · as of today',
      }
    },
  },

  {
    type: 'home_kpi_new_clients',
    group: 'Home',
    title: 'New Customers (with trend)',
    blurb: 'Customers gained, against the prior period',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => bothWindows(clientsReq, win),
    metric: (bag, _cfg, win) => {
      const now = one<ClientsRow>(bag, clientsReq(win))
      const prev = priorWindow(win)
      const then = one<ClientsRow>(bag, clientsReq(prev))
      const value = num(now?.new_in_window)
      return {
        kind: 'kpi',
        label: 'New Customers',
        value: value.toLocaleString(),
        sub: `${win.label} · ${num(now?.clients_active).toLocaleString()} active in total`,
        delta: delta(value, num(then?.new_in_window), prev, now?.coverage?.first_client ?? null),
        spark: (now?.new_by_month ?? []).map(m => num(m.count)),
      }
    },
  },

  {
    /**
     * ⚠ Carries the §8.2 rate floor into BOTH windows. A close rate off three
     * decisions is noise, and comparing one noisy rate against another manufactures
     * a dramatic swing out of nothing.
     */
    type: 'home_kpi_close_rate',
    group: 'Home',
    title: 'Close Rate (with trend)',
    blurb: 'Share of decided leads won, against the prior period',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => bothWindows(salesReq, win),
    metric: (bag, _cfg, win) => {
      const now = one<SalesRow>(bag, salesReq(win))
      const prev = priorWindow(win)
      const then = one<SalesRow>(bag, salesReq(prev))
      const floor = num(now?.rate_min_sample) || 10
      const decided = num(now?.decided)
      const rate = decided >= floor ? now?.close_rate ?? null : null
      const priorOk = num(then?.decided) >= floor
      return {
        kind: 'kpi',
        label: 'Close Rate',
        value: rate == null ? '—' : `${rate}%`,
        tone: rate == null ? 'neutral' : rate >= 50 ? 'good' : rate >= 30 ? 'warn' : 'bad',
        sub: rate == null
          ? `Only ${decided} decided ${decided === 1 ? 'lead' : 'leads'} — too few to rate fairly`
          : `${num(now?.won)} won of ${decided} decided · ${win.label}`,
        delta: rate != null && priorOk && then?.close_rate != null
          ? delta(rate, then.close_rate, prev, null)
          : rate != null
            ? { pct: null, text: `No comparison — under ${floor} decided leads before this`, tone: 'neutral' }
            : undefined,
      }
    },
  },

  {
    type: 'home_kpi_booked',
    group: 'Home',
    title: 'Work on the Books',
    blurb: 'Scheduled, priced work still to be done',
    defaultSpan: 3,
    config: {
      months: { kind: 'number', label: 'Look ahead', def: 6, min: 1, max: 24, unit: 'months' },
    },
    sources: cfg => [pulseReq(Number(cfg.months))],
    metric: (bag, cfg) => {
      const months = Number(cfg.months)
      const p = one<HomePulseRow>(bag, pulseReq(months))
      const b = p?.booked
      const unpriced = num(b?.unpriced_visits)
      return {
        kind: 'kpi',
        label: 'Work on the Books',
        value: formatCurrency(num(b?.total)),
        tone: 'good',
        sub: unpriced > 0
          ? `${num(b?.visits).toLocaleString()} visits scheduled over ${months} months · at least, ${unpriced} unpriced`
          : `${num(b?.visits).toLocaleString()} visits scheduled over the next ${months} months`,
      }
    },
  },

  {
    /**
     * The actionable band. Every chip is something a person can act on today, and
     * the two biggest ones — unbilled finished work and past-due invoices — are
     * money that already exists and simply hasn't arrived.
     */
    type: 'home_attention',
    group: 'Home',
    title: 'Needs Attention',
    blurb: 'What is sitting there costing you money right now',
    defaultSpan: 12,
    // No settings. Every chip is a count of a thing that either exists or doesn't;
    // there is nothing here to tune, and the settings panel is generated from this
    // schema — a knob that changes nothing would be worse than no knob.
    config: {},
    sources: () => [pulseReq(6), arReq()],
    metric: bag => {
      const p = one<HomePulseRow>(bag, pulseReq(6))
      const ar = one<InvoiceArRow>(bag, arReq())
      const a = p?.attention
      const overdue = num(ar?.overdue_total)
      const unbilled = num(a?.requires_invoicing_value)
      const late = num(a?.late_visits)
      const risk = num(a?.at_risk_clients)
      const matched = num(a?.at_risk_services_matched)
      const totalRs = num(a?.at_risk_services_total)
      const unmatched = Math.max(0, totalRs - matched)

      const chips: Extract<WidgetPayload, { kind: 'attention' }>['chips'] = [
        {
          key: 'unbilled',
          label: 'Work done, not billed',
          value: formatCurrency(unbilled),
          detail: `${num(a?.requires_invoicing_count)} jobs Jobber marks ready to invoice`,
          tone: unbilled > 0 ? 'bad' : 'good',
        },
        {
          key: 'overdue',
          label: 'Past-due invoices',
          value: formatCurrency(overdue),
          detail: `${num(ar?.overdue_count)} invoices past their due date`,
          tone: overdue > 0 ? 'bad' : 'good',
          href: '/hub/reports/revenue',
        },
        {
          key: 'late',
          label: 'Visits not completed',
          value: late.toLocaleString(),
          detail: late > 0 && a?.oldest_late_visit
            ? `Oldest scheduled ${prettyDate(a.oldest_late_visit)}`
            : 'Every scheduled visit is accounted for',
          tone: late > 0 ? 'warn' : 'good',
        },
        {
          key: 'at_risk',
          label: 'Recurring customers with nothing booked',
          value: risk.toLocaleString(),
          detail: unmatched > 0
            ? `Active recurring, no visit scheduled · ${unmatched} more can't be checked`
            : 'Active recurring customers with no visit on the calendar',
          tone: risk > 0 ? 'warn' : 'good',
          // No link on purpose. Retention explains churn RATES; it does not list
          // these specific customers, so sending someone there would answer a
          // different question than the one the chip raised.
        },
        {
          key: 'action',
          label: 'Jobs needing action',
          value: num(a?.action_required).toLocaleString(),
          detail: `Plus ${num(a?.unscheduled_jobs)} sold but never scheduled`,
          tone: num(a?.action_required) > 0 ? 'warn' : 'good',
        },
      ]

      return {
        kind: 'attention',
        title: 'Needs Attention',
        sub: p?.as_of ? `As of ${prettyDate(p.as_of)} — these ignore the date range above` : 'Right now',
        chips,
        foot: unmatched > 0
          ? `Recurring customers are matched to their Jobber client by email; ${unmatched} of ${totalRs} active services have no match and cannot appear in the at-risk count.`
          : undefined,
      }
    },
  },

  {
    type: 'home_booked_work',
    group: 'Home',
    title: 'Work on the Books by Month',
    blurb: 'Scheduled, priced work month by month',
    defaultSpan: 6,
    config: {
      months: { kind: 'number', label: 'Look ahead', def: 6, min: 2, max: 24, unit: 'months' },
    },
    sources: cfg => [pulseReq(Number(cfg.months))],
    metric: (bag, cfg) => {
      const months = Number(cfg.months)
      const p = one<HomePulseRow>(bag, pulseReq(months))
      const rows = p?.booked?.months ?? []
      const unpriced = num(p?.booked?.unpriced_visits)
      const partial = p?.booked?.first_month_partial === true
      return {
        kind: 'bars',
        title: 'Work on the Books by Month',
        sub: 'Scheduled and priced — not a forecast',
        format: 'currency',
        rows: rows.map((m, i) => ({
          label: monthLabel(m.month),
          value: num(m.total),
          tone: 'good' as Tone,
          detail: `${num(m.visits)} visits${i === 0 && partial ? ' · counted from today, so this month is partial' : ''}${
            num(m.unpriced) > 0 ? ` · ${m.unpriced} with no price on file` : ''}`,
        })),
        empty: 'No visits scheduled in this horizon',
        legend: unpriced > 0
          ? [{ label: `A floor, not an estimate — ${unpriced} scheduled visits carry no price`, tone: 'neutral' }]
          : undefined,
      }
    },
  },

  {
    type: 'home_snapshot',
    group: 'Home',
    title: 'The Ten-Second Read',
    blurb: 'Plain-language summary of the whole business',
    defaultSpan: 12,
    config: {},
    sources: (_cfg, win) => [
      ...bothWindows(invoiceReq, win),
      arReq(),
      clientsReq(win),
      salesReq(win),
      pulseReq(6),
    ],
    metric: (bag, _cfg, win) => {
      const now = one<InvoiceWindowRow>(bag, invoiceReq(win))
      const prev = priorWindow(win)
      const then = one<InvoiceWindowRow>(bag, invoiceReq(prev))
      const ar = one<InvoiceArRow>(bag, arReq())
      const cl = one<ClientsRow>(bag, clientsReq(win))
      const sales = one<SalesRow>(bag, salesReq(win))
      const p = one<HomePulseRow>(bag, pulseReq(6))
      const items: string[] = []

      const invoiced = num(now?.invoiced)
      const collected = num(now?.collected)
      const floor = now?.earliest_invoice ?? null
      const comparable = !floor || prev.start >= floor

      if (invoiced > 0) {
        const before = num(then?.invoiced)
        const d = comparable && before > 0
          ? ` — ${Math.abs(Math.round(((invoiced - before) / before) * 100))}% ${
              invoiced >= before ? 'more' : 'less'} than the same length of time before it (${prev.label})`
          : ''
        items.push(`Billed ${formatCurrency(invoiced)} and collected ${formatCurrency(collected)} in ${win.label}${d}.`)
      }
      if (!comparable && floor) {
        items.push(`Comparisons against the previous period are switched off here — invoice records only start ${prettyDate(floor)}, so an earlier period would read as a collapse rather than as missing data.`)
      }

      const unbilled = num(p?.attention?.requires_invoicing_value)
      const overdue = num(ar?.overdue_total)
      if (unbilled + overdue > 0) {
        items.push(`${formatCurrency(unbilled + overdue)} is money you have already earned but not received — ${formatCurrency(unbilled)} of finished work never invoiced, and ${formatCurrency(overdue)} invoiced but past due. This is the fastest cash in the business.`)
      }

      const booked = num(p?.booked?.total)
      if (booked > 0) {
        items.push(`${formatCurrency(booked)} of work is already scheduled and priced over the next ${num(p?.booked?.horizon_months)} months across ${num(p?.booked?.visits).toLocaleString()} visits — a floor, since ${num(p?.booked?.unpriced_visits)} scheduled visits carry no price on file.`)
      }

      const newClients = num(cl?.new_in_window)
      const active = num(cl?.clients_active)
      if (active > 0) {
        items.push(`${active.toLocaleString()} active customers, ${newClients.toLocaleString()} of them gained in this period, and ${num(cl?.recurring_services).toLocaleString()} recurring services worth ${formatCurrency(num(cl?.recurring_annual_value))} a year.`)
      }

      const decided = num(sales?.decided)
      if (sales?.close_rate != null && decided >= (num(sales.rate_min_sample) || 10)) {
        items.push(`${sales.close_rate}% of decided leads turned into sales (${num(sales.won)} of ${decided}), worth ${formatCurrency(num(sales.won_value))}.`)
      }

      const risk = num(p?.attention?.at_risk_clients)
      if (risk > 0) {
        items.push(`${risk} active recurring ${risk === 1 ? 'customer has' : 'customers have'} nothing on the calendar — recurring revenue quietly stops when the visits do.`)
      }

      return {
        kind: 'list',
        title: 'The Ten-Second Read',
        sub: `Across every report · ${win.label}`,
        items,
        empty: 'Not enough data yet to summarise',
      }
    },
  },
]

/**
 * The Home preset.
 *
 * Six tiles, then the actionable band, then the money picture, then the read. Note
 * how much of it is widgets built for OTHER reports (`invoiced_vs_collected`,
 * `ar_aging`) — that reuse is the whole argument for the widget library, and it is
 * why this page cost a fraction of the seven that came before it.
 */
export const HOME_REPORT_PRESET: { type: string; span: number; config?: WidgetConfig }[] = [
  { type: 'home_kpi_invoiced', span: 2 },
  { type: 'home_kpi_collected', span: 2 },
  { type: 'home_kpi_ar', span: 2 },
  { type: 'home_kpi_new_clients', span: 2 },
  { type: 'home_kpi_close_rate', span: 2 },
  { type: 'home_kpi_booked', span: 2 },
  { type: 'home_attention', span: 12 },
  { type: 'home_snapshot', span: 12 },
  { type: 'invoiced_vs_collected', span: 6 },
  { type: 'home_booked_work', span: 6 },
  { type: 'ar_aging', span: 6 },
]
