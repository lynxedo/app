/* Clients widgets — the library behind Report §8.4.
 *
 * "Is my client base growing, and who are my best clients?"
 *
 * ⚠⚠ NOTHING here is called Lifetime Value, even though §8.4 asks for it. Clients
 * go back to January 2025 but the invoice mirror starts at the Jobber backfill
 * floor (2026-01-02 for Heroes), so per-client spend is "billed since we started
 * holding invoices" — for a customer who joined in 2025 that is a fraction of what
 * they have actually paid. Labelling a partial figure "lifetime" would overstate
 * nothing and understate everything, which is worse than not showing it: it reads
 * authoritative while being wrong. Every card says **billed** and names the floor.
 *
 * ⚠ Leads are excluded from client counts. Jobber keeps 243 rows flagged `is_lead`
 * that have never bought anything; counting them would inflate the base and deflate
 * every per-client average.
 *
 * ⚠ No residential-vs-commercial split, which §8.4 also asks for: `is_company` is
 * true on 15 of 1,663 rows, and known commercial accounts (an HOA management firm)
 * are flagged false. The field isn't maintained, so a donut built on it would be
 * confidently wrong. It needs a real mapped field first.
 */

import { formatCurrency } from '@/lib/format'
import type { ClientsRow, ClientsGeoRow } from './sources'
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


const clientsReq = (win: WindowSpec) => ({
  source: 'clients_overview' as const,
  params: { start: win.start, end: win.end },
})

function clients(bag: SourceBag, win: WindowSpec): ClientsRow | null {
  return bag.get<ClientsRow>(clientsReq(win))[0] ?? null
}

function num(v: number | string | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function longDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** The phrase that keeps "billed" from being mistaken for lifetime spend. */
function billedSince(r: ClientsRow | null): string {
  return r?.coverage.first_invoice ? `billed since ${longDate(r.coverage.first_invoice)}` : 'billed to date'
}

export const CLIENTS_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'kpi_active_clients',
    group: 'Clients',
    title: 'Active Clients',
    blurb: 'Customers on the books right now',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [clientsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = clients(bag, win)
      return {
        kind: 'kpi',
        label: 'Active Clients',
        value: r ? num(r.clients_active).toLocaleString() : '—',
        sub: r
          ? `${num(r.clients_archived).toLocaleString()} archived · ${num(r.leads_open).toLocaleString()} still leads, not counted`
          : 'No clients yet',
      }
    },
  },

  {
    type: 'kpi_new_clients',
    group: 'Clients',
    title: 'New Clients',
    blurb: 'Customers added in the period',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [clientsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = clients(bag, win)
      return {
        kind: 'kpi',
        label: 'New Clients',
        value: r ? num(r.new_in_window).toLocaleString() : '—',
        tone: 'good',
        sub: r ? `${win.phrase} · ${num(r.new_30d).toLocaleString()} in the last 30 days` : 'None yet',
      }
    },
  },

  {
    type: 'kpi_avg_client_billed',
    group: 'Clients',
    title: 'Average Client Value',
    blurb: 'Typical amount billed per customer',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [clientsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = clients(bag, win)
      return {
        kind: 'kpi',
        label: 'Average Client Value',
        value: r?.billed_avg != null ? formatCurrency(num(r.billed_avg)) : '—',
        // ⚠ Names the window, never "lifetime" — see the file header.
        sub: r
          ? `Across ${num(r.billed_clients).toLocaleString()} customers billed ${win.phrase}`
          : 'Nothing billed yet',
      }
    },
  },

  {
    type: 'kpi_recurring_book',
    group: 'Clients',
    title: 'Recurring Book',
    blurb: 'Signed-up services and what they are worth a year',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [clientsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = clients(bag, win)
      return {
        kind: 'kpi',
        label: 'Recurring Services',
        value: r ? num(r.recurring_services).toLocaleString() : '—',
        tone: 'good',
        sub: r
          ? `${formatCurrency(num(r.recurring_annual_value))} a year on the books`
          : 'No recurring services',
        drill: { href: '/hub/reports/clients/recurring-customers', label: 'See the recurring book' },
      }
    },
  },

  {
    type: 'new_clients_by_month',
    group: 'Clients',
    title: 'New Clients by Month',
    blurb: 'Is the base growing?',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [clientsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = clients(bag, win)
      const rows = (r?.new_by_month ?? []).map(m => ({
        label: new Date(`${m.month}-15T12:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
        value: num(m.count),
        tone: 'good' as Tone,
      }))
      return {
        kind: 'bars',
        title: 'New Clients by Month',
        sub: `${win.phrase} · when each customer was first created`,
        format: 'number',
        rows,
        empty: 'No new clients in this period',
      }
    },
  },

  {
    type: 'clients_by_city',
    group: 'Clients',
    title: 'Where Your Customers Are',
    blurb: 'Service area by city',
    defaultSpan: 6,
    config: {
      topN: { kind: 'number', label: 'Show top', def: 10, min: 3, max: 30, unit: 'cities' },
    },
    sources: (_cfg, win) => [clientsReq(win)],
    metric: (bag, cfg, win) => {
      const r = clients(bag, win)
      const all = r?.by_city ?? []
      const shown = all.slice(0, Number(cfg.topN))
      const hidden = all.length - shown.length
      return {
        kind: 'bars',
        title: 'Where Your Customers Are',
        sub: hidden > 0
          ? `By property address · top ${shown.length} of ${all.length} cities`
          : 'By property address',
        format: 'number',
        rows: shown.map(c => ({ label: c.city, value: num(c.clients), tone: 'neutral' as Tone })),
        // Say what was cut rather than letting a top-N quietly imply it's everything.
        legend: hidden > 0 ? [{ label: `${hidden} smaller cities not shown`, tone: 'unknown' as Tone }] : undefined,
        empty: 'No property addresses on file',
      }
    },
  },

  {
    type: 'top_clients_table',
    group: 'Clients',
    title: 'Best Customers',
    blurb: 'Who spends the most, and when they last did',
    defaultSpan: 12,
    config: {
      topN: { kind: 'number', label: 'Show top', def: 20, min: 5, max: 50, unit: 'customers' },
    },
    sources: (_cfg, win) => [clientsReq(win)],
    metric: (bag, cfg, win) => {
      const r = clients(bag, win)
      const rows = (r?.top_clients ?? [])
        .slice(0, Number(cfg.topN))
        .map(c => ({
          key: c.client_id,
          cells: {
            name: c.name,
            billed: num(c.billed),
            invoices: num(c.invoices),
            last: c.last_billed ?? '—',
            days: num(c.days_since_last),
          },
          // Gone quiet for a season is worth seeing on a "best customers" list —
          // your biggest spender drifting away is the expensive kind of churn.
          tones: {
            days: (num(c.days_since_last) > 120 ? 'bad' : num(c.days_since_last) > 60 ? 'warn' : 'good') as Tone,
          },
          meta: c.archived
            ? { text: 'Archived in Jobber', tone: 'unknown' as Tone }
            : undefined,
        }))
      return {
        kind: 'table',
        title: 'Best Customers',
        sub: `Ranked by amount ${billedSince(r)}`,
        columns: [
          { key: 'name', label: 'Customer', align: 'left' },
          { key: 'billed', label: 'Billed', align: 'right', format: 'currency', sortable: true },
          { key: 'invoices', label: 'Invoices', align: 'right', format: 'number' },
          { key: 'last', label: 'Last invoice', align: 'left' },
          { key: 'days', label: 'Days since', align: 'right', format: 'number', sortable: true, title: 'Days since their last invoice.' },
        ],
        rows,
        /* ⚠ The line that stops this being read as lifetime value. */
        foot: r?.coverage.first_invoice
          ? `Billed totals cover invoices from ${longDate(r.coverage.first_invoice)} onward — that is as far back as the invoice records go, so a customer who joined earlier has paid more than this shows. It is not a lifetime figure.`
          : 'Billed totals cover the invoices on record.',
        empty: 'Nobody has been invoiced yet',
        // The card shows the top slice; this is every customer billed in the window.
        drill: drillTo('clients', 'customers-billed', win, 'See every customer billed'),
      }
    },
  },

  {
    type: 'clients_insights',
    group: 'Clients',
    title: 'What the Numbers Say',
    blurb: 'Plain-language read of the client base',
    defaultSpan: 12,
    config: {},
    sources: (_cfg, win) => [clientsReq(win)],
    metric: (bag, _cfg, win) => {
      const r = clients(bag, win)
      const items: string[] = []

      if (!r || num(r.clients_total) === 0) {
        return { kind: 'list', title: 'What the Numbers Say', sub: '', items: [], empty: 'No clients on record' }
      }

      items.push(`${num(r.clients_active).toLocaleString()} active customers, with ${num(r.clients_archived).toLocaleString()} archived. A further ${num(r.leads_open).toLocaleString()} rows are still marked as leads in Jobber and are left out of every figure here — they have not bought anything.`)

      items.push(`${num(r.new_in_window).toLocaleString()} customers were added ${win.phrase}, ${num(r.new_30d).toLocaleString()} of them in the last 30 days.`)

      if (num(r.recurring_services) > 0) {
        items.push(`${num(r.recurring_services).toLocaleString()} recurring services are on the books, worth ${formatCurrency(num(r.recurring_annual_value))} a year — the part of the base you can count on rather than having to win again.`)
      }

      if (r.billed_avg != null) {
        items.push(`${num(r.billed_clients).toLocaleString()} customers were invoiced ${win.phrase}, averaging ${formatCurrency(num(r.billed_avg))} each.`)
      }

      const top = (r.top_clients ?? [])[0]
      if (top) {
        items.push(`Biggest customer is ${top.name} at ${formatCurrency(num(top.billed))} across ${num(top.invoices)} invoices.`)
      }

      // A big spender who has gone quiet is the most expensive thing on this page.
      const quiet = (r.top_clients ?? []).filter(c => num(c.days_since_last) > 120 && !c.archived).slice(0, 3)
      if (quiet.length) {
        items.push(`⚠ ${quiet.map(c => `${c.name} (${formatCurrency(num(c.billed))}, ${num(c.days_since_last)} days)`).join(', ')} ${quiet.length === 1 ? 'is a good customer who has' : 'are good customers who have'} not been invoiced in months. Worth a call before it becomes churn you find out about later.`)
      }

      const cities = r.by_city ?? []
      if (cities.length > 1) {
        const top2 = cities.slice(0, 2)
        const total = cities.reduce((s, c) => s + num(c.clients), 0)
        const share = total > 0 ? Math.round((100 * top2.reduce((s, c) => s + num(c.clients), 0)) / total) : 0
        items.push(`${top2.map(c => `${c.city} (${num(c.clients)})`).join(' and ')} hold ${share}% of your customers between them, across ${cities.length} cities in all.`)
      }

      /* Same discipline as the other reports: name the floor rather than let a
       * partial figure pass as complete. */
      if (r.coverage.first_invoice) {
        items.push(`Note: spend figures start ${longDate(r.coverage.first_invoice)}, which is as far back as the invoice records reach — earlier than that is missing rather than zero, so these are not lifetime totals.`)
      }

      return { kind: 'list', title: 'What the Numbers Say', sub: `Read of ${win.phrase}`, items }
    },
  },
]

const geoReq = (win: WindowSpec) => ({
  source: 'clients_geo' as const,
  params: { start: win.start, end: win.end },
})

function geo(bag: SourceBag, win: WindowSpec): ClientsGeoRow | null {
  return bag.get<ClientsGeoRow>(geoReq(win))[0] ?? null
}

/* What the map could not draw. A ZIP we hold customers in but have no centre point
 * for is absent from the picture, and absent is indistinguishable from zero unless
 * the card says so. */
function geoNote(r: ClientsGeoRow | null, extra?: string): string | undefined {
  const parts: string[] = []
  if (extra) parts.push(extra)
  if (r && r.unmapped_zips > 0) {
    parts.push(
      `${r.unmapped_zips} ZIP${r.unmapped_zips === 1 ? '' : 's'} ` +
      `(${r.unmapped_clients} customer${r.unmapped_clients === 1 ? '' : 's'}) could not be placed on the map ` +
      `and are not counted above.`,
    )
  }
  return parts.length ? parts.join(' ') : undefined
}

export const CLIENTS_GEO_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'geo_revenue_by_zip',
    group: 'Clients',
    title: 'Revenue by Area',
    blurb: 'Which ZIPs bill the most',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [geoReq(win)],
    metric: (bag, _cfg, win) => {
      const r = geo(bag, win)
      const pts = (r?.points ?? []).filter(x => num(x.revenue) > 0)
      return {
        kind: 'geo',
        title: 'Revenue by Area',
        sub: `Billed in ${win.phrase} · by property ZIP`,
        format: 'currency',
        points: pts.map(x => ({
          id: x.zip,
          lat: num(x.lat),
          lng: num(x.lng),
          value: num(x.revenue),
          detail: `${num(x.total_clients)} customer${num(x.total_clients) === 1 ? '' : 's'}`,
        })),
        note: geoNote(r, 'Every billed dollar is on this map — the per-ZIP figures add up to the whole book.'),
        empty: 'Nothing billed in this period',
      }
    },
  },

  {
    type: 'geo_recurring_by_zip',
    group: 'Clients',
    title: 'Recurring Customers by Area',
    blurb: 'Where the subscription book is',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [geoReq(win)],
    metric: (bag, _cfg, win) => {
      const r = geo(bag, win)
      const pts = (r?.points ?? []).filter(x => num(x.recurring_clients) > 0)
      return {
        kind: 'geo',
        title: 'Recurring Customers by Area',
        sub: 'On the book today · ignores the date range',
        format: 'number',
        points: pts.map(x => ({
          id: x.zip,
          lat: num(x.lat),
          lng: num(x.lng),
          value: num(x.recurring_clients),
          detail: `of ${num(x.total_clients)} customer${num(x.total_clients) === 1 ? '' : 's'} in this ZIP`,
        })),
        // Point-in-time, like AR: "who is on the book" has no window. Said on the
        // card rather than letting it look like it ignored the picker above it.
        note: geoNote(r, 'Counts customers with a live recurring job in Jobber right now, so this map does not change with the date range.'),
        empty: 'No recurring customers on the book',
      }
    },
  },

  {
    type: 'geo_oneoff_by_zip',
    group: 'Clients',
    title: 'One-off Customers by Area',
    blurb: 'Where the job work comes from',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [geoReq(win)],
    metric: (bag, _cfg, win) => {
      const r = geo(bag, win)
      const pts = (r?.points ?? []).filter(x => num(x.oneoff_clients) > 0)
      return {
        kind: 'geo',
        title: 'One-off Customers by Area',
        sub: `Bought a one-off job in ${win.phrase}`,
        format: 'number',
        points: pts.map(x => ({
          id: x.zip,
          lat: num(x.lat),
          lng: num(x.lng),
          value: num(x.oneoff_clients),
          detail: `of ${num(x.total_clients)} customer${num(x.total_clients) === 1 ? '' : 's'} in this ZIP`,
        })),
        note: geoNote(r, 'A customer counts once per ZIP however many jobs they bought, so this is customers and not job volume.'),
        empty: 'No one-off work in this period',
      }
    },
  },
]

/** The arrangement Report §8.4 ships with. */
export const CLIENTS_REPORT_PRESET: { type: string; span: number }[] = [
  { type: 'kpi_active_clients', span: 3 },
  { type: 'kpi_new_clients', span: 3 },
  { type: 'kpi_avg_client_billed', span: 3 },
  { type: 'kpi_recurring_book', span: 3 },
  { type: 'clients_insights', span: 12 },
  { type: 'new_clients_by_month', span: 6 },
  { type: 'clients_by_city', span: 6 },
  { type: 'geo_revenue_by_zip', span: 6 },
  { type: 'geo_recurring_by_zip', span: 6 },
  { type: 'geo_oneoff_by_zip', span: 6 },
  { type: 'top_clients_table', span: 12 },
]
