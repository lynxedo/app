/* Revenue & Invoicing widgets — the library behind Report §8.3.
 *
 * The first Report built from scratch rather than ported off an existing board:
 * nothing in Scoreboards answered "am I making money and who owes me?".
 *
 * ⚠ TWO sources on purpose, and the split is the whole design.
 *
 *   invoice_window(start, end)   what we BILLED and COLLECTED in the period
 *   invoice_ar()                 what is owed RIGHT NOW — takes no dates
 *
 * Receivables are point-in-time. An invoice issued in March that is still unpaid
 * today is part of today's AR, but it is not part of a June–August window — so an
 * AR figure that quietly obeyed the date picker would drop most of the debt the
 * page exists to chase. Every widget below therefore states which of the two it
 * is: window widgets carry the window's phrase, AR widgets say "right now".
 *
 * That is the same discipline as the year-based retention widgets: when a number
 * cannot honestly follow the control above it, say so on the card instead of
 * letting the label imply something the data never meant.
 */

import { formatCurrency } from '@/lib/format'
import { customerFileHref } from '@/lib/customer-file-href'
import type { InvoiceArRow, InvoiceWindowRow } from './sources'
import type { SourceBag, WidgetDef, WindowSpec } from './types'
import type { Tone, WidgetPayload } from './payloads'

/**
 * Link from a figure to the rows behind it, carrying the CURRENT window so the
 * list is the same slice the number was read in. Point-in-time drill-downs
 * ignore the dates and say so on their own page.
 */
function drillTo(key: string, win: WindowSpec, label?: string) {
  return { href: `/hub/reports/revenue/${key}?start=${win.start}&end=${win.end}`, label }
}


const windowReq = (win: WindowSpec) => ({
  source: 'invoice_window' as const,
  params: { start: win.start, end: win.end },
})

/* No parameters at all — which is also what makes every AR widget on a board share
 * one query no matter how many of them there are. */
const arReq = () => ({ source: 'invoice_ar' as const, params: {} })

function windowRow(bag: SourceBag, win: WindowSpec): InvoiceWindowRow | null {
  return bag.get<InvoiceWindowRow>(windowReq(win))[0] ?? null
}

function arRow(bag: SourceBag): InvoiceArRow | null {
  return bag.get<InvoiceArRow>(arReq())[0] ?? null
}

/** Postgres numerics arrive as strings through PostgREST; a bare `+` would concatenate. */
function num(v: number | string | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null
  return Math.round((100 * part) / whole * 10) / 10
}

/** How overdue is too overdue. Anything past due is worth a call; 60+ is a problem. */
function agingTone(bucket: string): Tone {
  switch (bucket) {
    case 'Current': return 'neutral'
    case '1-30 days': return 'warn'
    case '31-60 days': return 'bad'
    default: return 'bad'
  }
}

function overdueTone(days: number): Tone {
  if (days <= 0) return 'neutral'
  if (days <= 30) return 'warn'
  return 'bad'
}

export const REVENUE_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'kpi_invoiced',
    group: 'Revenue',
    title: 'Total Invoiced',
    blurb: 'What you billed in the period',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [windowReq(win)],
    metric: (bag, _cfg, win) => {
      const r = windowRow(bag, win)
      const n = num(r?.invoice_count)
      return {
        kind: 'kpi',
        label: 'Total Invoiced',
        value: r ? formatCurrency(num(r.invoiced)) : '—',
        sub: r
          ? `${win.phrase} · ${n.toLocaleString()} invoice${n === 1 ? '' : 's'} sent`
          : 'No invoices in this period',
        drill: drillTo('invoices-issued', win, 'See every invoice'),
      }
    },
  },

  {
    type: 'kpi_collected',
    group: 'Revenue',
    title: 'Collected',
    blurb: 'How much of what you billed has come in',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [windowReq(win)],
    metric: (bag, _cfg, win) => {
      const r = windowRow(bag, win)
      const rate = r ? pct(num(r.collected), num(r.invoiced)) : null
      return {
        kind: 'kpi',
        label: 'Collected',
        value: r ? formatCurrency(num(r.collected)) : '—',
        // Collection rate, not raw dollars, decides the colour: $50k collected is
        // good or bad only relative to what was billed.
        tone: rate == null ? 'neutral' : rate >= 97 ? 'good' : rate >= 90 ? 'warn' : 'bad',
        judged: true,
        sub: r && rate != null
          ? `${rate}% of what was invoiced ${win.phrase}`
          : 'Nothing invoiced yet',
        drill: drillTo('invoices-issued', win, 'See what was collected'),
      }
    },
  },

  {
    /* ⚠ Point-in-time, NOT window-scoped — see the file header. */
    type: 'kpi_outstanding',
    group: 'Revenue',
    title: 'Outstanding Now',
    blurb: 'Money owed to you today, whenever it was billed',
    defaultSpan: 3,
    config: {},
    sources: () => [arReq()],
    metric: bag => {
      const r = arRow(bag)
      const overdue = num(r?.overdue_total)
      return {
        kind: 'kpi',
        label: 'Outstanding Now',
        value: r ? formatCurrency(num(r.total_ar)) : '—',
        tone: overdue > 0 ? 'bad' : 'good',
        judged: true,
        sub: r
          ? `${num(r.open_count)} unpaid · ${formatCurrency(overdue)} past due · as of today, not the date range`
          : 'Nothing outstanding',
        drill: { href: '/hub/reports/revenue/open-invoices', label: 'See who owes what' },
      }
    },
  },

  {
    type: 'kpi_avg_invoice',
    group: 'Revenue',
    title: 'Average Invoice',
    blurb: 'Typical invoice size in the period',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [windowReq(win)],
    metric: (bag, _cfg, win) => {
      const r = windowRow(bag, win)
      return {
        kind: 'kpi',
        label: 'Average Invoice',
        value: r && r.avg_invoice != null ? formatCurrency(num(r.avg_invoice)) : '—',
        sub: r ? `Across ${num(r.invoice_count).toLocaleString()} invoices ${win.phrase}` : 'No invoices yet',
        drill: drillTo('invoices-issued', win, 'See every invoice'),
      }
    },
  },

  {
    type: 'kpi_days_to_pay',
    group: 'Revenue',
    title: 'Days to Payment',
    blurb: 'How long customers take to pay',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [windowReq(win)],
    metric: (bag, _cfg, win) => {
      const r = windowRow(bag, win)
      const median = r?.median_days_to_pay
      /* Median, not average, is the headline. Heroes takes payment at the visit, so
       * the typical invoice settles the same day — but one 90-day straggler pulls
       * the average up to about a day, which would invent a collections problem
       * that isn't there. The average is kept in the subtitle so a widening gap
       * between the two is still visible. */
      return {
        kind: 'kpi',
        label: 'Days to Payment',
        value: median != null ? (num(median) === 0 ? 'Same day' : `${num(median)} days`) : '—',
        tone: median == null ? 'neutral' : num(median) <= 7 ? 'good' : num(median) <= 30 ? 'warn' : 'bad',
        judged: true,
        sub: r && r.avg_days_to_pay != null
          ? `Typical (median) of ${num(r.paid_count).toLocaleString()} paid · average ${num(r.avg_days_to_pay)} days`
          : 'Nothing paid yet in this period',
      }
    },
  },

  {
    /* Company-wide rather than window-scoped: two of Heroes' three drafts carry no
     * issue date at all, so a windowed count would report one draft while three sit
     * there unbilled. "What's stuck in drafts" is a right-now question. */
    type: 'kpi_draft_unsent',
    group: 'Revenue',
    title: 'Draft / Unsent',
    blurb: 'Work finished but never invoiced',
    defaultSpan: 3,
    config: {},
    sources: () => [arReq()],
    metric: bag => {
      const r = arRow(bag)
      const n = num(r?.draft_count)
      return {
        kind: 'kpi',
        label: 'Draft / Unsent',
        value: r ? formatCurrency(num(r.draft_value)) : '—',
        tone: n > 0 ? 'warn' : 'good',
        judged: true,
        sub: n > 0
          ? `${n} invoice${n === 1 ? '' : 's'} never sent — nobody has been asked to pay this`
          : 'Nothing sitting in drafts',
        drill: { href: '/hub/reports/revenue/draft-invoices', label: 'See the drafts' },
      }
    },
  },

  {
    type: 'invoiced_vs_collected',
    group: 'Revenue',
    title: 'Invoiced vs Collected by Month',
    blurb: 'Each month billed, split by what came in',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [windowReq(win)],
    metric: (bag, _cfg, win) => {
      const r = windowRow(bag, win)
      const rows = (r?.monthly ?? []).map(m => {
        const invoiced = num(m.invoiced)
        const collected = num(m.collected)
        return {
          label: new Date(`${m.month}-15T12:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
          caption: formatCurrency(invoiced),
          /* Collected is a SUBSET of invoiced, so stack collected + the remainder.
           * Stacking invoiced AND collected side by side would double-count every
           * dollar that has been paid — the same trap the churn trend avoided. */
          parts: [
            { value: collected, tone: 'good' as Tone, label: 'Collected' },
            { value: Math.max(0, invoiced - collected), tone: 'bad' as Tone, label: 'Still owed' },
          ],
        }
      })
      return {
        kind: 'stacked',
        format: 'currency',
        title: 'Invoiced vs Collected by Month',
        sub: `${win.phrase} · bar length is what was billed, green is what came in`,
        rows,
        legend: [{ label: 'Collected', tone: 'good' }, { label: 'Still owed', tone: 'bad' }],
        empty: 'No invoices in this period',
      }
    },
  },

  {
    type: 'ar_aging',
    group: 'Revenue',
    title: 'Accounts Receivable Aging',
    blurb: 'How old the unpaid money is',
    defaultSpan: 6,
    config: {},
    sources: () => [arReq()],
    metric: bag => {
      const r = arRow(bag)
      const rows = (r?.buckets ?? []).map(b => ({
        label: b.bucket,
        value: num(b.balance),
        tone: agingTone(b.bucket),
        detail: `${num(b.count)} invoice${num(b.count) === 1 ? '' : 's'}`,
      }))
      return {
        kind: 'bars',
        title: 'Accounts Receivable Aging',
        sub: `As of today · ${formatCurrency(num(r?.total_ar))} owed across ${num(r?.open_count)} invoices`,
        format: 'currency',
        rows,
        legend: [
          { label: 'Not yet due', tone: 'neutral' },
          { label: 'Up to 30 days late', tone: 'warn' },
          { label: 'Over 30 days late', tone: 'bad' },
        ],
        empty: 'Nothing outstanding — everything invoiced has been paid',
      }
    },
  },

  {
    type: 'revenue_mix',
    group: 'Revenue',
    title: 'Recurring vs One-off',
    blurb: 'Where the billed money comes from',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [windowReq(win)],
    metric: (bag, _cfg, win) => {
      const r = windowRow(bag, win)
      const parts = (r?.mix ?? [])
        .filter(m => num(m.invoiced) > 0)
        .map(m => ({
          label: m.kind,
          value: Math.round(num(m.invoiced)),
          tone: (m.kind === 'Recurring' ? 'good' : m.kind === 'One-off' ? 'mixed' : 'unknown') as Tone,
        }))
      const recurring = r?.mix.find(m => m.kind === 'Recurring')
      const share = recurring ? pct(num(recurring.invoiced), num(r?.invoiced)) : null
      return {
        kind: 'donut',
        title: 'Recurring vs One-off',
        sub: `${win.phrase} · by dollars invoiced`,
        format: 'currency',
        parts,
        note: share != null
          ? `${share}% of billed revenue comes from recurring work — the part you can count on next month. "Unlinked" is an invoice with no job attached, usually a manual one.`
          : 'Recurring work is the revenue you can count on next month.',
        empty: 'No invoices in this period',
      }
    },
  },

  {
    type: 'invoices_to_collect',
    group: 'Revenue',
    title: 'Invoices to Collect',
    blurb: 'Who owes you, largest balance first',
    defaultSpan: 12,
    config: {
      topN: { kind: 'number', label: 'Show top', def: 15, min: 5, max: 50, unit: 'invoices' },
    },
    sources: () => [arReq()],
    metric: (bag, cfg) => {
      const r = arRow(bag)
      const rows = (r?.invoices ?? [])
        .slice(0, Number(cfg.topN))
        .map(inv => ({
          key: inv.id,
          cells: {
            client: inv.client_name,
            // Collecting a debt means talking to the customer, so their name opens
            // the file the Call and Text buttons live on. Not rendered as a column.
            client_href: inv.client_id ? customerFileHref(inv.client_id) : null,
            invoice: inv.invoice_number ? `#${inv.invoice_number}` : '—',
            issued: inv.issued_date ?? '—',
            days: num(inv.days_past_due) > 0 ? num(inv.days_past_due) : 0,
            balance: num(inv.balance),
          },
          tones: {
            days: overdueTone(num(inv.days_past_due)),
            balance: overdueTone(num(inv.days_past_due)),
          },
          /* Surfacing the status matters BECAUSE it can lie — an invoice stamped
           * "paid" that still owes money is exactly the row a manager needs to see
           * rather than one silently filtered out. */
          meta: inv.status === 'paid'
            ? { text: 'Marked paid in Jobber but still shows a balance', tone: 'bad' as Tone }
            : undefined,
        }))
      const owing = num(r?.paid_status_still_owing_count)
      return {
        kind: 'table',
        title: 'Invoices to Collect',
        sub: `As of today · ${formatCurrency(num(r?.total_ar))} owed across ${num(r?.open_count)} invoices`,
        /* ⚠ Balance comes before Days late on purpose. The table auto-sorts by its
         * FIRST sortable column, and the source hands back the 100 largest balances
         * — so if Days sorted by default, the list would look ordered by age while
         * having been *selected* by size, quietly dropping a small invoice that is
         * a year late. Selection and default order have to agree; both stay
         * clickable so either question can be asked. */
        columns: [
          { key: 'client', label: 'Customer', align: 'left', link: { hrefKey: 'client_href' } },
          { key: 'invoice', label: 'Invoice', align: 'left' },
          { key: 'issued', label: 'Issued', align: 'left' },
          { key: 'balance', label: 'Balance', align: 'right', format: 'currency', sortable: true },
          { key: 'days', label: 'Days late', align: 'right', format: 'number', sortable: true, title: 'Days past the due date. 0 means not due yet.' },
        ],
        rows,
        // ⚠ This note was the exact inverse until 2026-08-12. It said the list was
        // built from the balance "not its status", and that the paid-but-owing rows
        // were included because filtering by status would hide them. Re-reading
        // every open invoice from Jobber showed the opposite: Jobber's own books
        // treat those as settled, and counting them overstated receivables ~4x.
        foot: owing > 0
          ? `Built from what Jobber still considers open. ${owing} further ${owing === 1 ? 'invoice carries' : 'invoices carry'} a balance (${formatCurrency(num(r?.paid_status_still_owing_value))}) while marked paid — Jobber treats those as settled, so they are excluded here, but they are worth a look as a recording problem.`
          : 'Built from what Jobber still considers open — drafts and settled invoices are excluded.',
        empty: 'Nothing to collect — every invoice is settled',
        drill: { href: '/hub/reports/revenue/open-invoices', label: 'See every unpaid invoice' },
      }
    },
  },

  {
    type: 'revenue_insights',
    group: 'Revenue',
    title: 'What the Numbers Say',
    blurb: 'Plain-language read of cash health',
    defaultSpan: 12,
    config: {},
    sources: (_cfg, win) => [windowReq(win), arReq()],
    metric: (bag, _cfg, win) => {
      const r = windowRow(bag, win)
      const ar = arRow(bag)
      const items: string[] = []

      if (!r || num(r.invoice_count) === 0) {
        return {
          kind: 'list',
          title: 'What the Numbers Say',
          sub: '',
          items: [],
          empty: `No invoices were issued ${win.phrase}`,
        }
      }

      const rate = pct(num(r.collected), num(r.invoiced))
      items.push(`${win.phrase}: invoiced ${formatCurrency(num(r.invoiced))} across ${num(r.invoice_count).toLocaleString()} invoices and collected ${formatCurrency(num(r.collected))}${rate != null ? ` (${rate}%)` : ''}.`)

      if (ar && num(ar.total_ar) > 0) {
        const late = num(ar.overdue_total)
        items.push(`${formatCurrency(num(ar.total_ar))} is outstanding right now across ${num(ar.open_count)} invoices, ${formatCurrency(late)} of it past due. That figure is as of today and ignores the date range above, because a debt does not stop existing when you narrow the dates.`)

        const worst = (ar.buckets ?? []).find(b => b.bucket === '60+ days')
        if (worst && num(worst.count) > 0) {
          items.push(`${num(worst.count)} invoice${num(worst.count) === 1 ? ' is' : 's are'} more than 60 days late, worth ${formatCurrency(num(worst.balance))} — the least likely to ever be paid, so chase these first.`)
        }

        if (num(ar.paid_status_still_owing_count) > 0) {
          items.push(`⚠ ${num(ar.paid_status_still_owing_count)} invoices are marked paid in Jobber but still show a balance totalling ${formatCurrency(num(ar.paid_status_still_owing_value))}. They are included above because this page counts what is owed, not what an invoice is labelled — worth checking whether the payment was recorded properly.`)
        }

        if (num(ar.credit_count) > 0) {
          items.push(`${num(ar.credit_count)} invoice${num(ar.credit_count) === 1 ? ' carries' : 's carry'} a credit balance of ${formatCurrency(Math.abs(num(ar.credit_balance)))} (overpayment). Credits are reported separately rather than subtracted from what is owed, so the outstanding figure is not flattered.`)
        }
      } else {
        items.push('Nothing is outstanding — every invoice sent has been paid in full.')
      }

      if (ar && num(ar.draft_count) > 0) {
        items.push(`${num(ar.draft_count)} invoice${num(ar.draft_count) === 1 ? '' : 's'} worth ${formatCurrency(num(ar.draft_value))} ${num(ar.draft_count) === 1 ? 'is' : 'are'} still in draft — finished work nobody has been asked to pay for yet. That is the fastest money on this page.`)
      }

      const recurring = r.mix.find(m => m.kind === 'Recurring')
      const share = recurring ? pct(num(recurring.invoiced), num(r.invoiced)) : null
      if (share != null) {
        items.push(`${share}% of billed revenue came from recurring work; the rest is one-off jobs that have to be won again next month.`)
      }

      /* The mirror only holds invoices from the Jobber backfill floor onward. Without
       * this line a window reaching further back draws a chart that looks like the
       * business collapsed, when in truth we simply do not hold the data. */
      if (r.earliest_invoice && win.start < r.earliest_invoice) {
        items.push(`Note: the oldest invoice on record here is ${new Date(`${r.earliest_invoice}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}. Your date range starts before that, so anything earlier is missing from this page rather than genuinely zero.`)
      }

      return { kind: 'list', title: 'What the Numbers Say', sub: `Read of ${win.phrase}`, items }
    },
  },
]

/** The arrangement Report §8.3 ships with. */
export const REVENUE_REPORT_PRESET: { type: string; span: number }[] = [
  { type: 'kpi_invoiced', span: 3 },
  { type: 'kpi_collected', span: 3 },
  { type: 'kpi_outstanding', span: 3 },
  { type: 'kpi_avg_invoice', span: 3 },
  { type: 'kpi_days_to_pay', span: 3 },
  { type: 'kpi_draft_unsent', span: 3 },
  { type: 'revenue_insights', span: 12 },
  { type: 'invoiced_vs_collected', span: 6 },
  { type: 'ar_aging', span: 6 },
  { type: 'invoices_to_collect', span: 12 },
  { type: 'revenue_mix', span: 6 },
]
