/* Revenue by lead source — which channel the money actually came from.
 *
 * Ben asked for "annual revenue by source". Two facts shaped what got built, and
 * both are stated on the card's own face rather than buried here.
 *
 * ⚠⚠ 1. THERE IS NO "ANNUAL", AND THE CARD SAYS SO. `invoices` for Heroes begins
 * 2026-01-02, so a year-to-date window and a trailing-twelve window return the
 * IDENTICAL figure. The card takes the board's window like every other card and
 * names the slice it read. Calling it "annual" would promise a year of history that
 * does not exist — the same trap the visit-history floor set in August, where a
 * trailing-12 ticket average silently equalled year-to-date.
 *
 * ⚠⚠ 2. "BY SOURCE" HAS TWO HONEST ANSWERS THAT DISAGREE ABOUT A THIRD OF THE MONEY,
 * so it is a SETTING and the card names which one produced the number.
 *
 * Measured Jan–Aug 2026, of 538 invoiced clients: 350 ($295,314) match a Lead
 * Tracker row and 188 ($182,646) do not — the Tracker only begins 2025-07-13, so
 * anyone won before then has no row at all. 161 clients — $163,445, 34% of revenue —
 * get a DIFFERENT label from each source.
 *
 * The disagreement runs almost entirely one way, and that is the whole story: a
 * Tracker row is created when somebody calls back for a NEW job, so an existing
 * customer's repair logs as "Repeat / Existing Customer", while Jobber's client field
 * still holds the channel that originally WON them. Jobber "SERV" → Tracker "Repeat"
 * alone is 40 clients and $14,851.
 *
 *   Acquisition   — Jobber's client field wins, the Tracker fills its blanks.
 *                   "Which channel won the customers who paid me." SERV: $21,060.
 *   What drove it — the Lead Tracker wins, Jobber fills its blanks.
 *                   "What brought in this period's work." SERV: $1,608.
 *
 * ⚠ Acquisition is the DEFAULT because the failure modes are not symmetrical. Under
 * "what drove it", Repeat becomes 47% of revenue and swallows the chart, and a
 * channel that won customers two years ago reads as nearly dead — you would cut SERV
 * on a $1,608 reading of a $21,060 channel. Acquisition's failure is milder: it
 * credits an old channel for revenue a repeat visit produced, which overstates
 * durability without ever hiding a live channel.
 *
 * ⚠ The Tracker is not the lesser source, which is why it is the fallback rather
 * than ignored: it is the ONLY thing that attributes ~$12.4k Jobber files as Unknown
 * (Google $6,926, Customer Referral $2,223, Angi Leads $1,870) and the only source
 * naming Google Ads (PPC) at all — $475, where Jobber has $0.
 *
 * ⚠⚠ FILED UNDER REVENUE, NOT MARKETING, BECAUSE THE GROUP IS THE ACCESS DECISION.
 * The dimension is a lead source but the payload is company revenue totals, and
 * `WIDGET_GROUP_REPORT` maps the group straight to the report that gates it. Putting
 * it in Marketing would hand every marketing-grant holder the company's invoiced
 * revenue through a card that looks like a channel report — the same side door the
 * Aug-12 audit closed at the RPC layer. Someone who should see both already can.
 */

import type { RevenueBySourceRow } from './sources'
import type { SourceBag, SourceRequest, WidgetConfig, WidgetDef, WindowSpec } from './types'
import type { Tone, WidgetPayload } from './payloads'
import { formatCurrency } from '@/lib/format'

const num = (v: number | string | null | undefined): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const UNKNOWN_SOURCE = 'Other / Unknown'

const RULE_ACQUISITION = 'Who won the customer'
const RULE_RECENT = 'What drove the job'

const BASIS_INVOICED = 'Invoiced'
const BASIS_COLLECTED = 'Collected'

const SHAPE_BARS = 'Bars'
const SHAPE_TABLE = 'Table'

/** The rule as the database names it. One place, so the card and the query agree. */
function ruleParam(cfg: WidgetConfig): 'acquisition' | 'recent_touch' {
  return String(cfg.creditRule) === RULE_RECENT ? 'recent_touch' : 'acquisition'
}

function req(cfg: WidgetConfig, win: WindowSpec): SourceRequest {
  return {
    source: 'revenue_by_source',
    params: { start: win.start, end: win.end, creditRule: ruleParam(cfg) },
  }
}

/**
 * Cost type decides the colour, exactly as it does on Board 8's mix card — paid
 * channels read differently from free ones at a glance.
 *
 * ⚠ Unknown is toned 'unknown' rather than 'bad'. It is not a failing channel, it is
 * the absence of attribution, and 22 of the library's KPI tones are decoration
 * anyway — a colour here is a category, never a verdict.
 */
function costTone(costType: string, source: string): Tone {
  if (source === UNKNOWN_SOURCE) return 'unknown'
  switch (costType) {
    case 'Paid': return 'paid'
    case 'Free': return 'free'
    case 'Mixed': return 'mixed'
    default: return 'unknown'
  }
}

export const REVENUE_SOURCE_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'revenue_by_source',
    group: 'Revenue',
    title: 'Revenue by Lead Source',
    blurb: 'What each channel billed in the period',
    defaultSpan: 6,
    config: {
      creditRule: {
        kind: 'enum' as const,
        label: 'Credit the revenue to',
        def: RULE_ACQUISITION,
        opts: [RULE_ACQUISITION, RULE_RECENT],
        hint: '“Who won the customer” reads Jobber’s lead source and falls back to the Lead Tracker — best for judging what a channel is worth. “What drove the job” reads the Lead Tracker first, so repeat business is credited as Repeat instead of to the channel that first won them.',
      },
      basis: {
        kind: 'enum' as const,
        label: 'Count',
        def: BASIS_INVOICED,
        opts: [BASIS_INVOICED, BASIS_COLLECTED],
        hint: 'Invoiced is what you billed in the period. Collected is what has actually come in against those invoices.',
      },
      shape: {
        kind: 'enum' as const,
        label: 'Show as',
        def: SHAPE_BARS,
        opts: [SHAPE_BARS, SHAPE_TABLE],
        hint: 'The table adds invoice and customer counts per channel.',
      },
      topN: {
        kind: 'number' as const,
        label: 'Show top',
        def: 10, min: 3, max: 25, unit: 'sources',
      },
      hideUnknown: {
        kind: 'bool' as const,
        label: 'Hide Other / Unknown',
        def: false,
        hint: 'Unknown is a mixed bag rather than a channel — but it is 18% of revenue, so the card keeps saying how much it is even when the bar is hidden.',
      },
      label: {
        kind: 'text' as const,
        label: 'Name on the card',
        def: '',
        placeholder: 'e.g. 2026 Revenue by Channel',
      },
    },
    sources: (cfg, win) => [req(cfg, win)],
    metric: (bag, cfg, win): WidgetPayload => {
      const row = bag.get<RevenueBySourceRow>(req(cfg, win))[0] ?? null
      const collected = String(cfg.basis) === BASIS_COLLECTED
      const pick = (r: { invoiced: number | string | null; collected: number | string | null }) =>
        num(collected ? r.collected : r.invoiced)

      const all = row?.by_source ?? []
      const total = num(collected ? row?.collected : row?.invoiced)
      const unknownValue = all
        .filter(r => r.source === UNKNOWN_SOURCE)
        .reduce((s, r) => s + pick(r), 0)

      /* ⚠ Rank on the basis being SHOWN, not always on invoiced. Sorting a collected
       * chart by invoiced dollars puts the bars out of order, which reads as a
       * rendering bug rather than as a sort choice. */
      const shown = all
        .filter(r => !(cfg.hideUnknown === true && r.source === UNKNOWN_SOURCE))
        .filter(r => pick(r) > 0)
        .sort((a, b) => pick(b) - pick(a))
        .slice(0, Number(cfg.topN))

      /* The card's own account of how it was built.
       *
       * ⚠⚠ The rule comes from `row.credit_rule` — what the DATABASE applied — not
       * from the config. The function falls back to acquisition on an unrecognised
       * value, so trusting the config would caption the card with the rule that was
       * asked for in exactly the case where the two differ. */
      const ruleUsed = row?.credit_rule === 'recent_touch' ? RULE_RECENT : RULE_ACQUISITION
      const notes: string[] = [
        `credited to ${ruleUsed.toLowerCase()}`,
      ]
      /* ⚠⚠ THE HONESTY LINE. Unknown is not a channel and is often the second
       * biggest bar, so a card that hides it — or truncates it away with topN —
       * silently shrinks the denominator every percentage is read against. Stated
       * whenever there is any, including when the bar is on screen, because "18% of
       * this chart is unattributed" is the thing that decides how much to trust it. */
      if (unknownValue > 0 && total > 0) {
        notes.push(
          `${formatCurrency(unknownValue)} (${Math.round((100 * unknownValue) / total)}%) unattributed`,
        )
      }
      /* Truncation is never silent — see the same rule on the tracked-item cards.
       *
       * ⚠ Counted against what was ELIGIBLE to be drawn, not against every source.
       * A hidden Unknown is not a "smaller source" — it is usually the second
       * biggest, and the user hid it on purpose — so counting it here read as
       * "11 smaller sources" when ten were smaller and the eleventh was Unknown.
       * A source that billed nothing is excluded for the same reason: it is not
       * something the reader is missing. */
      const eligible = all
        .filter(r => pick(r) > 0)
        .filter(r => !(cfg.hideUnknown === true && r.source === UNKNOWN_SOURCE))
      const hiddenCount = eligible.length - shown.length
      if (hiddenCount > 0) {
        notes.push(`${hiddenCount} smaller source${hiddenCount === 1 ? '' : 's'} not shown`)
      }

      const title = String(cfg.label).trim()
        || `${collected ? 'Collected' : 'Revenue'} by Lead Source`
      const sub = `${win.phrase} · ${notes.join(' · ')}`

      if (!shown.length) {
        return {
          kind: 'bars', title, sub, format: 'currency', rows: [],
          empty: 'No invoiced revenue in this period',
        }
      }

      if (String(cfg.shape) === SHAPE_TABLE) {
        return {
          kind: 'table',
          title,
          sub,
          columns: [
            { key: 'source', label: 'Lead source', align: 'left', sortable: true },
            { key: 'cost', label: 'Cost', align: 'left', sortable: true, title: 'Whether the channel is paid, free or a mix — from the lead-source master list.' },
            { key: 'value', label: collected ? 'Collected' : 'Invoiced', align: 'right', format: 'currency', sortable: true },
            { key: 'share', label: 'Share', align: 'right', format: 'percent', sortable: true },
            { key: 'clients', label: 'Customers', align: 'right', format: 'number', sortable: true },
            { key: 'invoices', label: 'Invoices', align: 'right', format: 'number', sortable: true },
          ],
          rows: shown.map(r => ({
            key: r.source,
            cells: {
              source: r.source,
              cost: r.cost_type,
              value: pick(r),
              share: total > 0 ? Math.round((1000 * pick(r)) / total) / 10 : 0,
              clients: num(r.client_count),
              invoices: num(r.invoice_count),
            },
            tones: { source: costTone(r.cost_type, r.source) },
          })),
          foot: `${formatCurrency(total)} across ${num(row?.clients).toLocaleString('en-US')} customers`,
        }
      }

      return {
        kind: 'bars',
        title,
        sub,
        format: 'currency',
        rows: shown.map(r => ({
          label: r.source,
          value: pick(r),
          tone: costTone(r.cost_type, r.source),
          detail: `${num(r.client_count).toLocaleString('en-US')} customer${num(r.client_count) === 1 ? '' : 's'} · ${num(r.invoice_count).toLocaleString('en-US')} invoice${num(r.invoice_count) === 1 ? '' : 's'}${total > 0 ? ` · ${Math.round((1000 * pick(r)) / total) / 10}% of ${collected ? 'collected' : 'revenue'}` : ''}`,
        })),
        legend: [
          { label: 'Paid', tone: 'paid' },
          { label: 'Free', tone: 'free' },
          { label: 'Mixed', tone: 'mixed' },
          { label: 'Unattributed', tone: 'unknown' },
        ],
      }
    },
  },
]
