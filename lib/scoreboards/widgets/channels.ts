/* The channel scorecard — what each marketing dollar is buying.
 *
 * Ben, Aug 24 2026: *"Think like a business owner that is wanting to track where his
 * marketing dollars are going. We spend X amount of dollars on Google. What is that X
 * dollars getting us? How many customers/jobs? How much revenue? Close rate? How does
 * Google compare to Angi."*
 *
 * ⚠⚠ WHY THIS EXISTS RATHER THAN A TWEAK TO THE MARKETING CARDS. Nine of the ten cards
 * on §8.9 read the lead-source SCORECARD, whose universe is `recurring_services` —
 * customers who signed a recurring programme. One-off work is not in it. On Google,
 * Jan–Aug 2026, that is the difference between "13 new customers" and 165 Tracker
 * leads / 142 invoiced customers / $118,983 billed, because 49% of Google's revenue
 * comes from customers with no programme at all. Those cards are not wrong, they
 * answer a narrower question than the one an owner asks about ad spend.
 *
 * ⚠⚠ THE ASYMMETRY, STATED SO NOBODY "FIXES" IT. Leads are counted under the LEAD's own
 * source; revenue is credited to the CUSTOMER's acquisition channel (the same rule and
 * default as the Revenue by Lead Source card). That is deliberate and it is what an
 * owner wants — Google keeps credit for revenue it is still producing, while a repeat
 * call shows as this period's job activity — but it means one row's leads and revenue
 * can describe different people. `Revenue per lead` is therefore a channel-efficiency
 * indicator, NOT an arithmetic average per lead, and the card says so.
 *
 * ⚠⚠ FILED UNDER REVENUE, NOT MARKETING, and this is the more consequential version of
 * the same call made for `revenue_by_source`: this card carries company revenue AND
 * what the business pays for leads, which is the most commercially sensitive pairing
 * on the platform. `WIDGET_GROUP_REPORT` maps group → gating report, so Marketing
 * would hand every marketing-grant holder both. Deliberately NOT added to the
 * Marketing report preset either — `widgetReportSlugs` unions the group's report with
 * any preset that places the widget, so placing it there would re-open the same door.
 *
 * ⚠ Spend is hand-entered in Admin → Reports and may not exist. Every spend-derived
 * column is hidden entirely when nothing has been entered, rather than drawn as a
 * column of dashes that looks like a broken card.
 */

import type { ChannelRow } from './sources'
import type { SourceBag, SourceRequest, WidgetConfig, WidgetDef, WindowSpec } from './types'
import type { Tone, WidgetPayload } from './payloads'
import { formatCurrency } from '@/lib/format'

const num = (v: number | string | null | undefined): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
/** Null-preserving: a missing figure must stay missing, not become 0. See the header. */
const maybe = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const UNKNOWN_SOURCE = 'Other / Unknown'

const RULE_ACQUISITION = 'Who won the customer'
const RULE_RECENT = 'What drove the job'

const CREDIT_FIELD = {
  kind: 'enum' as const,
  label: 'Credit the revenue to',
  def: RULE_ACQUISITION,
  opts: [RULE_ACQUISITION, RULE_RECENT],
  hint: 'Leads are always counted under their own source. This decides only who gets the REVENUE: the channel that originally won the customer, or the one on their most recent Tracker row.',
}

function req(cfg: WidgetConfig, win: WindowSpec): SourceRequest {
  return {
    source: 'channel_scorecard',
    params: {
      start: win.start,
      end: win.end,
      creditRule: String(cfg.creditRule) === RULE_RECENT ? 'recent_touch' : 'acquisition',
    },
  }
}

function row(bag: SourceBag, cfg: WidgetConfig, win: WindowSpec): ChannelRow | null {
  return bag.get<ChannelRow>(req(cfg, win))[0] ?? null
}

/** Cost type is a category, never a verdict — Unknown is absence, not failure. */
function costTone(costType: string, source: string): Tone {
  if (source === UNKNOWN_SOURCE) return 'unknown'
  switch (costType) {
    case 'Paid': return 'paid'
    case 'Free': return 'free'
    case 'Mixed': return 'mixed'
    default: return 'unknown'
  }
}

/* The metrics the comparison chart can draw. Kept as one table so the labels, the
 * value getter and the number format can never drift apart. `higherIsBetter` is only
 * used to pick a tone; `invert` marks the two where a SMALLER number is the good one. */
const MEASURES = {
  'Leads': { get: (r: ChannelRow['by_source'][0]) => maybe(r.leads), fmt: 'number' as const, invert: false },
  'Jobs won': { get: (r: ChannelRow['by_source'][0]) => maybe(r.closed_won), fmt: 'number' as const, invert: false },
  'Close rate': { get: (r: ChannelRow['by_source'][0]) => maybe(r.close_rate), fmt: 'percent' as const, invert: false },
  'Customers': { get: (r: ChannelRow['by_source'][0]) => maybe(r.customers), fmt: 'number' as const, invert: false },
  'Revenue': { get: (r: ChannelRow['by_source'][0]) => maybe(r.revenue), fmt: 'currency' as const, invert: false },
  'Revenue per lead': { get: (r: ChannelRow['by_source'][0]) => maybe(r.revenue_per_lead), fmt: 'currency' as const, invert: false },
  'Cost per lead': { get: (r: ChannelRow['by_source'][0]) => maybe(r.cost_per_lead), fmt: 'currency' as const, invert: true },
  'Cost per customer': { get: (r: ChannelRow['by_source'][0]) => maybe(r.cost_per_customer), fmt: 'currency' as const, invert: true },
  'Return on ad spend': { get: (r: ChannelRow['by_source'][0]) => maybe(r.roas), fmt: 'number' as const, invert: false },
}
type MeasureName = keyof typeof MEASURES
const MEASURE_NAMES = Object.keys(MEASURES) as MeasureName[]
/** The three that need spend entered before they can say anything. */
const SPEND_MEASURES = new Set<MeasureName>(['Cost per lead', 'Cost per customer', 'Return on ad spend'])

/** How the card describes its own basis, once, so both widgets say it the same way. */
function basisNote(r: ChannelRow | null, win: WindowSpec): string {
  const rule = r?.credit_rule === 'recent_touch' ? RULE_RECENT : RULE_ACQUISITION
  return `${win.phrase} · jobs from the Lead Tracker, revenue from Jobber · revenue credited to ${rule.toLowerCase()}`
}

export const CHANNEL_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'channel_scorecard',
    group: 'Revenue',
    title: 'Marketing Channel Scorecard',
    blurb: 'Leads, close rate, revenue and cost per channel',
    defaultSpan: 12,
    config: {
      creditRule: CREDIT_FIELD,
      minLeads: {
        kind: 'number' as const,
        label: 'Hide channels under',
        def: 0, min: 0, max: 50, unit: 'leads',
        hint: 'A channel with one lead and a 100% close rate is noise, not a finding. Set this above zero to drop them — the card says how many it dropped.',
      },
      hideUnknown: {
        kind: 'bool' as const,
        label: 'Hide Other / Unknown',
        def: false,
        hint: 'Unknown is a mixed bag rather than a channel — but the card keeps reporting how big it is either way.',
      },
      label: { kind: 'text' as const, label: 'Name on the card', def: '', placeholder: 'e.g. Where the marketing money goes' },
    },
    sources: (cfg, win) => [req(cfg, win)],
    metric: (bag, cfg, win): WidgetPayload => {
      const r = row(bag, cfg, win)
      const all = r?.by_source ?? []
      const hasSpend = r?.has_spend === true
      const min = Number(cfg.minLeads)

      const shown = all
        .filter(x => !(cfg.hideUnknown === true && x.source === UNKNOWN_SOURCE))
        .filter(x => num(x.leads) >= min || num(x.revenue) > 0)
        .sort((a, b) => num(b.revenue) - num(a.revenue))

      const dropped = all.length - shown.length
      const totalRev = num(r?.revenue)
      const unknownRev = all
        .filter(x => x.source === UNKNOWN_SOURCE)
        .reduce((s, x) => s + num(x.revenue), 0)

      const notes = [basisNote(r, win)]
      if (unknownRev > 0 && totalRev > 0) {
        notes.push(`${formatCurrency(unknownRev)} (${Math.round((100 * unknownRev) / totalRev)}%) unattributed`)
      }
      if (dropped > 0) notes.push(`${dropped} small channel${dropped === 1 ? '' : 's'} hidden`)
      /* ⚠⚠ The card must say when the money half is simply absent. Without this the
       * three cost columns are invisible and the card looks like it was built without
       * them, rather than like it is waiting for a number only a human can supply. */
      if (!hasSpend) notes.push('no ad spend entered yet — add it in Admin → Reports for cost per lead and return on spend')

      const columns = [
        { key: 'source', label: 'Channel', align: 'left' as const, sortable: true },
        { key: 'leads', label: 'Leads', align: 'right' as const, format: 'number' as const, sortable: true, title: 'Every appearance in the Lead Tracker in this period — jobs, not just new recurring customers.' },
        { key: 'won', label: 'Won', align: 'right' as const, format: 'number' as const, sortable: true },
        { key: 'close', label: 'Close rate', align: 'right' as const, format: 'percent' as const, sortable: true, title: 'Closed Won as a share of Won + Lost. Upsell-type stages are excluded on purpose — an upsell was never in competition.' },
        { key: 'customers', label: 'Customers', align: 'right' as const, format: 'number' as const, sortable: true, title: 'Distinct customers invoiced in this period whose channel this is.' },
        { key: 'revenue', label: 'Revenue', align: 'right' as const, format: 'currency' as const, sortable: true },
        { key: 'perLead', label: 'Rev / lead', align: 'right' as const, format: 'currency' as const, sortable: true, title: 'Revenue divided by leads. An efficiency indicator, not an average per lead — leads and revenue can describe different people on the same row.' },
        ...(hasSpend ? [
          { key: 'spend', label: 'Spend', align: 'right' as const, format: 'currency' as const, sortable: true },
          { key: 'cpl', label: 'Cost / lead', align: 'right' as const, format: 'currency' as const, sortable: true },
          { key: 'cpc', label: 'Cost / customer', align: 'right' as const, format: 'currency' as const, sortable: true },
          { key: 'roas', label: 'ROAS', align: 'right' as const, format: 'number' as const, sortable: true, title: 'Revenue divided by spend. 4.0 means four dollars billed for every dollar spent.' },
        ] : []),
      ]

      return {
        kind: 'table',
        title: String(cfg.label).trim() || 'Marketing Channel Scorecard',
        sub: notes.join(' · '),
        columns,
        rows: shown.map(x => ({
          key: x.source,
          cells: {
            source: x.source,
            leads: num(x.leads),
            won: num(x.closed_won),
            close: maybe(x.close_rate),
            customers: num(x.customers),
            revenue: num(x.revenue),
            perLead: maybe(x.revenue_per_lead),
            spend: maybe(x.spend),
            cpl: maybe(x.cost_per_lead),
            cpc: maybe(x.cost_per_customer),
            roas: maybe(x.roas),
          },
          tones: { source: costTone(x.cost_type, x.source) },
        })),
        foot: `${num(r?.leads).toLocaleString('en-US')} leads · ${num(r?.closed_won).toLocaleString('en-US')} won · ${formatCurrency(totalRev)} billed${hasSpend ? ` · ${formatCurrency(num(r?.spend))} spent` : ''}`,
        empty: 'No leads or revenue in this period',
      }
    },
  },

  {
    type: 'channel_compare',
    group: 'Revenue',
    title: 'Channel Comparison',
    blurb: 'One measure across every channel, side by side',
    defaultSpan: 6,
    config: {
      measure: {
        kind: 'enum' as const,
        label: 'Compare on',
        def: 'Revenue per lead' as string,
        opts: MEASURE_NAMES as unknown as string[],
        hint: 'The last three need ad spend entered in Admin → Reports before they can show anything.',
      },
      creditRule: CREDIT_FIELD,
      minLeads: {
        kind: 'number' as const,
        label: 'Hide channels under',
        def: 5, min: 0, max: 50, unit: 'leads',
        hint: 'Defaults above zero here because a bar chart makes a one-lead channel look equal to a hundred-lead one. The card names how many it dropped.',
      },
      hideUnknown: { kind: 'bool' as const, label: 'Hide Other / Unknown', def: true, hint: 'Unknown is a mixed bag, not a channel.' },
      label: { kind: 'text' as const, label: 'Name on the card', def: '', placeholder: 'e.g. Google vs Angi' },
    },
    sources: (cfg, win) => [req(cfg, win)],
    metric: (bag, cfg, win): WidgetPayload => {
      const r = row(bag, cfg, win)
      const name = (MEASURE_NAMES.includes(String(cfg.measure) as MeasureName)
        ? String(cfg.measure) : 'Revenue per lead') as MeasureName
      const m = MEASURES[name]
      const min = Number(cfg.minLeads)
      const title = String(cfg.label).trim() || `${name} by Channel`

      const candidates = (r?.by_source ?? [])
        .filter(x => !(cfg.hideUnknown === true && x.source === UNKNOWN_SOURCE))
        .filter(x => num(x.leads) >= min)

      /* ⚠ A channel whose value is NULL is DROPPED, not drawn as zero. On the three
       * spend measures that is every channel with no spend recorded, and drawing them
       * at zero would rank "we have never recorded a cost" as the cheapest channel we
       * have. */
      const rows = candidates
        .map(x => ({ x, v: m.get(x) }))
        .filter((e): e is { x: typeof e.x; v: number } => e.v !== null)
        .sort((a, b) => m.invert ? a.v - b.v : b.v - a.v)

      const notes = [basisNote(r, win)]
      const droppedSmall = (r?.by_source ?? []).length - candidates.length
      if (droppedSmall > 0) notes.push(`under ${min} leads hidden`)
      if (m.invert) notes.push('lower is better')

      if (!rows.length) {
        return {
          kind: 'bars', title, sub: notes.join(' · '), format: m.fmt, rows: [],
          empty: SPEND_MEASURES.has(name)
            ? 'Add your monthly ad spend in Admin → Reports to see this'
            : 'Nothing to compare in this period',
        }
      }

      return {
        kind: 'bars',
        title,
        sub: notes.join(' · '),
        format: m.fmt,
        rows: rows.map(({ x, v }) => ({
          label: x.source,
          value: v,
          tone: costTone(x.cost_type, x.source),
          /* Always carries the lead count. A close rate off 6 leads and one off 136
           * are not equally solid claims, and a bar chart draws them identically —
           * the same reason the per-technician ticket chart puts job counts on its
           * bars. */
          detail: `${num(x.leads).toLocaleString('en-US')} lead${num(x.leads) === 1 ? '' : 's'} · ${num(x.closed_won).toLocaleString('en-US')} won · ${formatCurrency(num(x.revenue))} billed`,
        })),
        legend: [
          { label: 'Paid', tone: 'paid' },
          { label: 'Free', tone: 'free' },
          { label: 'Mixed', tone: 'mixed' },
        ],
      }
    },
  },
]
