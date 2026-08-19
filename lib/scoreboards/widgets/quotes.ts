/* Quote widgets — the Jobber half of Report §8.2 Sales & Pipeline.
 *
 * The Lead Tracker half of that report measures leads → won/lost. This half measures
 * QUOTES, which live in Jobber and were not mirrored at all until 2026-08-13. The two
 * funnels sit side by side rather than being stitched together: joining a Jobber quote
 * to a Lead Tracker lead needs an identity match nobody has proven yet, and Ben's rule
 * is that the Lead Tracker is the authority on any per-deal disagreement.
 *
 * ⚠⚠ NO DOLLARS ANYWHERE, and that is the whole design rather than a gap. Jobber's
 * `amounts.total` counts only NON-OPTIONAL line items, and Heroes quotes options
 * constantly — quote #5659 reported $0.00 while carrying $14,175 of line items, because
 * every install choice was optional. Summing that column reports the entire irrigation
 * pipeline as zero; summing line items double-counts every option the customer will
 * pick exactly one of. Ben: "It isn't worth anything till the customer clicks what he
 * wants and approves. So maybe we don't deal with dollars." So this counts quotes.
 *
 * ⚠⚠ WON KEYS OFF THE STATUS, NEVER THE TIMESTAMPS — the opposite of the usual Jobber
 * rule, and the data proved it: 28 of 113 converted quotes carry NO `approvedAt`,
 * because they were sold in person and converted straight to a job. Keying on the
 * timestamp would have reported 86 wins against a true 113, throwing away a quarter of
 * real sales — specifically the ones closed face-to-face. One archived quote carries an
 * `approvedAt` too (approved, then killed), which timestamp logic would score as a win.
 *
 * ⚠ Two sources, because two different questions. The cohort ("of the quotes we sent in
 * July, how many did we win") obeys the date picker. The open book ("which quotes are
 * unanswered right now") cannot — an unanswered quote sent in June belongs in today's
 * chase list and would vanish from an August window, and the stale ones are exactly the
 * ones worth chasing. Same split §8.3 made for receivables, and the open cards say
 * "as of today" on their face.
 */

import { customerFileHref } from '@/lib/customer-file-href'
import type { QuoteCohortRow, QuoteOpenRow } from './sources'
import type { SourceBag, WidgetDef, WindowSpec } from './types'
import type { Tone, WidgetPayload } from './payloads'
import { NO_TECH, keepPerson, peopleField, personFilter, withPeople, withPeopleTitle } from './people-filter'

const cohortReq = (win: WindowSpec) => ({
  source: 'quotes_cohort' as const,
  params: { start: win.start, end: win.end },
})

/** No params: point-in-time, like invoice_ar. */
const openReq = () => ({ source: 'quotes_open' as const, params: {} })

function cohort(bag: SourceBag, win: WindowSpec): QuoteCohortRow | null {
  return bag.get<QuoteCohortRow>(cohortReq(win))[0] ?? null
}

function openBook(bag: SourceBag): QuoteOpenRow | null {
  return bag.get<QuoteOpenRow>(openReq())[0] ?? null
}

function num(v: number | string | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function rateTone(pct: number | null): Tone {
  if (pct == null) return 'neutral'
  return pct >= 60 ? 'good' : pct >= 40 ? 'warn' : 'bad'
}

/** Service codes are stored as the Jobber line-item prefix; spell them out. */
const SERVICE_LABEL: Record<string, string> = {
  IR: 'Irrigation',
  WF: 'Weed & Feed',
  PW: 'Pet Waste',
  MO: 'Mosquito',
  LD: 'Landscape',
  Unclassified: 'Unclassified',
}
const serviceLabel = (code: string) => SERVICE_LABEL[code] ?? code

export const QUOTE_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'kpi_quotes_sent',
    group: 'Quotes',
    title: 'Quotes Sent',
    blurb: 'Quotes that went out',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [cohortReq(win)],
    metric: (bag, _cfg, win) => {
      const r = cohort(bag, win)
      if (!r) return { kind: 'kpi', label: 'Quotes Sent', value: '—', sub: 'No quotes in this period' }
      // ⚠ The cohort is `sentAt ?? createdAt`. Five converted quotes were never
      // formally sent (sold on the spot), and a sent-only cohort would silently drop
      // real wins — so they are counted here and the card says so rather than the
      // number quietly meaning something other than its label.
      const spot = num(r.sold_on_the_spot)
      return {
        kind: 'kpi',
        label: 'Quotes Sent',
        value: num(r.sent).toLocaleString(),
        sub: spot > 0
          ? `${win.phrase} · includes ${spot} sold on the spot, never formally sent`
          : `${win.phrase} · ${num(r.still_open).toLocaleString()} still open`,
      }
    },
  },

  {
    type: 'kpi_quote_win_rate',
    group: 'Quotes',
    title: 'Quote Win Rate',
    blurb: 'Share of decided quotes won',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [cohortReq(win)],
    metric: (bag, _cfg, win) => {
      const r = cohort(bag, win)
      if (!r) return { kind: 'kpi', label: 'Quote Win Rate', value: '—', sub: 'No quotes in this period' }
      const decided = num(r.decided)
      // Same floor as the lead close rate: a flawless rate off three decisions is
      // noise dressed as excellence. Below it, say so rather than print a number.
      if (r.win_rate == null) {
        return {
          kind: 'kpi',
          label: 'Quote Win Rate',
          value: '—',
          sub: `Only ${decided} decided ${win.phrase} — too few to rate fairly`,
          tone: 'neutral',
        }
      }
      return {
        kind: 'kpi',
        label: 'Quote Win Rate',
        value: `${num(r.win_rate)}%`,
        tone: rateTone(num(r.win_rate)),
        sub: `${num(r.won).toLocaleString()} won of ${decided.toLocaleString()} decided · ${num(r.still_open).toLocaleString()} still open, not counted either way`,
      }
    },
  },

  {
    type: 'kpi_quote_time_to_win',
    group: 'Quotes',
    title: 'Time to Win',
    blurb: 'Typical days from sent to won',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [cohortReq(win)],
    metric: (bag, _cfg, win) => {
      const r = cohort(bag, win)
      if (!r || r.median_days_to_win == null) {
        return { kind: 'kpi', label: 'Time to Win', value: '—', sub: 'Not enough won quotes to measure' }
      }
      const d = num(r.median_days_to_win)
      return {
        kind: 'kpi',
        label: 'Time to Win',
        value: d === 0 ? 'Same day' : `${d} days`,
        tone: d <= 3 ? 'good' : d <= 10 ? 'warn' : 'bad',
        sub: `Median across ${num(r.win_time_sample).toLocaleString()} won quotes ${win.phrase}`,
      }
    },
  },

  {
    type: 'kpi_quotes_open_now',
    group: 'Quotes',
    title: 'Open Quotes',
    blurb: 'Unanswered right now',
    defaultSpan: 3,
    config: {},
    // ⚠ No window: point-in-time. The card says "as of today" so it never looks like
    // it is obeying the date picker above it.
    sources: () => [openReq()],
    metric: (bag) => {
      const o = openBook(bag)
      if (!o) return { kind: 'kpi', label: 'Open Quotes', value: '—', sub: 'as of today' }
      const oldest = num(o.oldest_days)
      return {
        kind: 'kpi',
        label: 'Open Quotes',
        value: num(o.open_total).toLocaleString(),
        tone: oldest > 30 ? 'warn' : 'neutral',
        sub: num(o.open_total) > 0
          ? `as of today · oldest sent ${oldest} days ago`
          : 'as of today · nothing waiting',
      }
    },
  },

  {
    type: 'quote_open_split',
    group: 'Quotes',
    title: 'Waiting On The Customer',
    blurb: 'Never opened vs read and unanswered',
    defaultSpan: 6,
    config: {},
    sources: () => [openReq()],
    metric: (bag) => {
      const o = openBook(bag)
      const never = num(o?.never_opened)
      const read = num(o?.opened_no_reply)
      // ⚠⚠ This split is the point of the whole card, and it is only possible because
      // Jobber records clientHubViewedAt. "Never opened" and "read and ignored" are two
      // different jobs: the first asks whether it even reached them (wrong email, spam
      // folder, never actually sent), the second is a follow-up call. A single
      // "awaiting response" count flattens them into one and tells you neither.
      //
      // ⚠ Never-opened counts ONLY quotes with a real sent_at — a quote sold on the
      // spot was never sent, so "the customer never opened it" would be false and
      // would send someone chasing a customer who has already bought.
      return {
        kind: 'bars',
        title: 'Waiting On The Customer',
        sub: 'Open quotes as of today — the date range does not apply',
        format: 'number',
        rows: [
          { label: 'Never opened it', value: never, tone: never > 0 ? 'bad' : 'good', detail: 'Did it reach them at all?' },
          { label: 'Read it, no answer', value: read, tone: read > 0 ? 'warn' : 'good', detail: 'Worth a follow-up call' },
        ],
        empty: 'No quotes are waiting on a customer',
      }
    },
  },

  {
    type: 'quote_aging',
    group: 'Quotes',
    title: 'How Long They Have Been Waiting',
    blurb: 'Age of open quotes',
    defaultSpan: 6,
    config: {},
    sources: () => [openReq()],
    metric: (bag) => {
      const o = openBook(bag)
      const a = o?.aging
      return {
        kind: 'bars',
        title: 'How Long They Have Been Waiting',
        sub: 'Open quotes as of today, by days since sent',
        format: 'number',
        rows: [
          { label: 'Under a week', value: num(a?.d0_7), tone: 'good' },
          { label: '8 – 14 days', value: num(a?.d8_14), tone: 'neutral' },
          { label: '15 – 30 days', value: num(a?.d15_30), tone: 'warn' },
          { label: 'Over 30 days', value: num(a?.d31), tone: 'bad' },
        ],
        empty: 'No quotes are waiting on a customer',
      }
    },
  },

  {
    type: 'quote_open_list',
    group: 'Quotes',
    title: 'Quotes Waiting For An Answer',
    blurb: 'Oldest first, with whether the customer opened it',
    defaultSpan: 12,
    config: { people: peopleField('jobber_people', 'people') },
    sources: () => [openReq()],
    metric: (bag, cfg) => {
      const o = openBook(bag)
      const f = personFilter(cfg)
      const rows = (o?.list ?? []).filter(q => keepPerson(f, q.salesperson, NO_TECH)).map(q => ({
        key: String(q.quote_number ?? Math.random()),
        cells: {
          days_out: num(q.days_out),
          quote: q.quote_number ? `#${q.quote_number}` : '—',
          // The two hrefs are cells, not columns: they never render, never sort and
          // never reach the Excel export. One row, two different jobs — resend the
          // quote in Jobber, or ring the customer — so each gets its own cell link
          // rather than one whole-row target that would have to pick a winner.
          quote_href: q.jobber_uri,
          client: q.client,
          client_href: q.client_id ? customerFileHref(q.client_id) : null,
          opened: q.viewed ? 'Opened it' : 'Never opened',
          service: serviceLabel(q.service),
          salesperson: q.salesperson,
        },
        tones: { opened: (q.viewed ? 'warn' : 'bad') as Tone },
      }))
      const total = num(o?.list_total)
      const cap = num(o?.list_cap)
      return {
        kind: 'table',
        title: withPeopleTitle('Quotes Waiting For An Answer', f),
        sub: withPeople('As of today, oldest first — the date range does not apply', f),
        columns: [
          { key: 'days_out', label: 'Days waiting', align: 'right', format: 'number', sortable: true },
          { key: 'quote', label: 'Quote', align: 'left', link: { hrefKey: 'quote_href', external: true }, title: 'Opens this quote in Jobber, where it can be resent.' },
          { key: 'client', label: 'Customer', align: 'left', sortable: true, link: { hrefKey: 'client_href' }, title: 'Opens their customer file, where you can call or text them.' },
          { key: 'opened', label: 'Customer opened it?', align: 'left', sortable: true },
          { key: 'service', label: 'Service', align: 'left', sortable: true },
          { key: 'salesperson', label: 'Salesperson', align: 'left', sortable: true },
        ],
        rows,
        // ⚠ A truncated list must never read as complete.
        // Was "look up a quote by its number in Jobber" — a workaround for having no
        // link. Both cells are now clickable, so the note says what they do instead.
        /* ⚠⚠ The person filter is applied to the CAPPED list, so when the cap bites
         * a filtered card shows "this person's quotes among the oldest N" — not all of
         * theirs. Said outright, because a filtered subset of a truncated list reads
         * exactly like a complete answer. When the cap is not binding (Heroes: 32 open
         * against a cap of 100) the filtered list IS complete, so no caveat is added. */
        foot: total > cap
          ? `Showing the ${cap} longest-waiting of ${total.toLocaleString()} open quotes${f.active ? ', and this card then narrows to the people you picked — so it is their quotes within that oldest ' + cap + ', not all of theirs' : ''}. The quote number opens it in Jobber; the name opens their customer file.`
          : 'The quote number opens it in Jobber to resend; the customer name opens their file, where you can call or text them.',
        empty: f.active ? 'No quotes from these people are waiting on a customer' : 'No quotes are waiting on a customer',
      }
    },
  },

  {
    type: 'quote_followthrough',
    group: 'Quotes',
    title: 'Approved, Not Yet A Job',
    blurb: 'Customer said yes and nothing happened',
    defaultSpan: 3,
    config: {},
    sources: () => [openReq()],
    metric: (bag) => {
      const o = openBook(bag)
      const n = num(o?.approved_not_converted)
      // A watchdog, not a chart. It read 0 on 2026-08-13 — when a customer approves,
      // the office converts it — so the sub line says that zero is the healthy answer
      // rather than leaving a bare 0 looking like a broken widget.
      return {
        kind: 'kpi',
        label: 'Approved, Not Yet A Job',
        value: n.toLocaleString(),
        tone: n === 0 ? 'good' : 'bad',
        judged: true,
        sub: n === 0
          ? 'as of today · nothing approved is sitting unscheduled'
          : 'as of today · the customer said yes and it never became work',
      }
    },
  },

  {
    type: 'quote_win_trend',
    group: 'Quotes',
    title: 'Quote Win Rate By Month',
    blurb: 'Win rate month by month',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [cohortReq(win)],
    metric: (bag, _cfg, win) => {
      const r = cohort(bag, win)
      const months = (r?.by_month ?? []).filter(m => m.win_rate != null)
      return {
        kind: 'bars',
        title: 'Quote Win Rate By Month',
        sub: `Quotes sent ${win.phrase}, by the month they went out`,
        format: 'percent',
        rows: months.map(m => ({
          label: m.month,
          value: num(m.win_rate),
          tone: rateTone(num(m.win_rate)),
          detail: `${num(m.won)} of ${num(m.decided)} decided`,
        })),
        // A month under the floor is omitted from the chart, not drawn at zero.
        empty: 'No month has enough decided quotes to rate fairly',
      }
    },
  },

  {
    type: 'quote_by_service',
    group: 'Quotes',
    title: 'Quotes By Service Line',
    blurb: 'Which work gets quoted and won',
    defaultSpan: 6,
    config: {},
    sources: (_cfg, win) => [cohortReq(win)],
    metric: (bag, _cfg, win) => {
      const r = cohort(bag, win)
      const rows = (r?.by_service ?? [])
      return {
        kind: 'bars',
        title: 'Quotes By Service Line',
        sub: `Sent ${win.phrase} · grouped by line item, not quote title`,
        format: 'number',
        rows: rows.map(s => ({
          label: serviceLabel(s.code),
          value: num(s.sent),
          tone: s.win_rate == null ? 'neutral' : rateTone(num(s.win_rate)),
          detail: s.win_rate == null
            ? `${num(s.won)} won — too few decided to rate`
            : `${num(s.win_rate)}% won of ${num(s.decided)} decided`,
        })),
        // ⚠ Heroes has no quote-title protocol ("Untitled", "RRR", "Backflow options"
        // all describe overlapping work), so grouping is by the line-item prefix the
        // Service Lines report already uses. Quotes whose items carry no recognised
        // prefix land in Unclassified rather than being dropped.
        empty: 'No quotes were sent in this period',
      }
    },
  },

  {
    type: 'quote_by_person',
    group: 'Quotes',
    title: 'Quotes By Salesperson',
    blurb: 'Sent, won and win rate per person',
    defaultSpan: 12,
    config: { people: peopleField('jobber_people', 'people') },
    sources: (_cfg, win) => [cohortReq(win)],
    metric: (bag, cfg, win) => {
      const r = cohort(bag, win)
      const f = personFilter(cfg)
      const people = (r?.by_salesperson ?? []).filter(p => keepPerson(f, p.name, NO_TECH))
      const floor = num(r?.rate_min_sample)
      return {
        kind: 'table',
        title: withPeopleTitle('Quotes By Salesperson', f),
        sub: withPeople(`Quotes sent ${win.phrase}`, f),
        columns: [
          { key: 'name', label: 'Salesperson', align: 'left', sortable: true },
          { key: 'sent', label: 'Sent', align: 'right', format: 'number', sortable: true },
          { key: 'won', label: 'Won', align: 'right', format: 'number', sortable: true },
          { key: 'decided', label: 'Decided', align: 'right', format: 'number', sortable: true },
          { key: 'win_rate', label: 'Win rate', align: 'right', sortable: true },
        ],
        rows: people.map(p => ({
          key: p.rep_id,
          cells: {
            name: p.name,
            sent: num(p.sent),
            won: num(p.won),
            decided: num(p.decided),
            // Below the floor the cell says why rather than showing a flattering rate
            // or dropping the person off the table entirely.
            win_rate: p.win_rate == null ? 'too few to rate fairly' : `${num(p.win_rate)}%`,
          },
          tones: { win_rate: rateTone(p.win_rate == null ? null : num(p.win_rate)) },
        })),
        foot: `A win rate needs at least ${floor} decided quotes. Quotes with no salesperson on them are grouped as Unassigned.`,
        empty: f.active ? 'No quotes sent by these people in this period' : 'No quotes were sent in this period',
      }
    },
  },

  {
    type: 'quote_insights',
    group: 'Quotes',
    title: 'What The Quote Numbers Say',
    blurb: 'Plain-language read of the quote funnel',
    defaultSpan: 12,
    config: {},
    sources: (_cfg, win) => [cohortReq(win), openReq()],
    metric: (bag, _cfg, win) => {
      const r = cohort(bag, win)
      const o = openBook(bag)
      const items: string[] = []

      if (!r || num(r.sent) === 0) {
        return { kind: 'list', title: 'What The Quote Numbers Say', sub: '', items: [], empty: `No quotes went out ${win.phrase}` }
      }

      items.push(`${num(r.sent).toLocaleString()} quotes went out ${win.phrase}. ${num(r.won).toLocaleString()} were won, ${num(r.lost).toLocaleString()} were lost, and ${num(r.still_open).toLocaleString()} are still open.`)

      if (r.win_rate != null) {
        items.push(`That is a ${num(r.win_rate)}% win rate on decided quotes. Quotes still waiting are not counted either way — a quote sent yesterday is not a loss.`)
      }

      if (r.median_days_to_win != null) {
        const d = num(r.median_days_to_win)
        items.push(`Quotes that win are typically won ${d === 0 ? 'the same day they go out' : `in about ${d} days`}. A quote that has been out much longer than that is unlikely to close on its own.`)
      }

      // The single most actionable line on the page, and the one a Jobber-only tool
      // cannot produce — it needs clientHubViewedAt.
      const never = num(o?.never_opened)
      if (never > 0) {
        items.push(`⚠ ${never} open ${never === 1 ? 'quote has' : 'quotes have'} never been opened by the customer. That is a different problem from being ignored — check the email actually reached them before chasing the sale.`)
      }
      const read = num(o?.opened_no_reply)
      if (read > 0) {
        items.push(`${read} open ${read === 1 ? 'quote has' : 'quotes have'} been read without an answer. Those are follow-up calls, and they are the warmest ones on the list.`)
      }

      const spot = num(r.sold_on_the_spot)
      if (spot > 0) {
        items.push(`${spot} of these were never formally sent — built and converted on the spot. They are counted as quotes so the sale is not lost from the total, but they can never appear in the never-opened list.`)
      }

      const unassigned = (r.by_salesperson ?? []).find(p => p.rep_id === 'unassigned')
      if (unassigned && num(unassigned.sent) > 0) {
        items.push(`${num(unassigned.sent).toLocaleString()} quotes have no salesperson recorded on them, so they cannot be credited to anyone.`)
      }

      const unclassified = (r.by_service ?? []).find(s => s.code === 'Unclassified')
      if (unclassified && num(unclassified.sent) > 0) {
        items.push(`${num(unclassified.sent).toLocaleString()} quotes have no recognisable service code on their line items, so they sit in Unclassified rather than being left out of the chart.`)
      }

      items.push('Quote counts are deliberately not shown in dollars: a quote made of optional line items is not worth anything until the customer picks what they want, so a total would be a guess wearing a real label.')

      return { kind: 'list', title: 'What The Quote Numbers Say', sub: '', items }
    },
  },
]

/** Appended to the Sales report — the Lead Tracker half comes first. */
export const QUOTE_REPORT_PRESET: { type: string; span: number }[] = [
  { type: 'kpi_quotes_sent', span: 3 },
  { type: 'kpi_quote_win_rate', span: 3 },
  { type: 'kpi_quote_time_to_win', span: 3 },
  { type: 'kpi_quotes_open_now', span: 3 },
  { type: 'quote_insights', span: 12 },
  { type: 'quote_open_split', span: 6 },
  { type: 'quote_aging', span: 6 },
  { type: 'quote_open_list', span: 12 },
  { type: 'quote_win_trend', span: 6 },
  { type: 'quote_by_service', span: 6 },
  { type: 'quote_by_person', span: 9 },
  { type: 'quote_followthrough', span: 3 },
]
