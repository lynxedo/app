/* Tracked items — "how many Rachio controllers did we sell, and who sold them?"
 *
 * Pick values from the Lead Tracker's Service column; the widget counts the leads
 * carrying them. One tile per product you care about, or one table listing several.
 *
 * ⚠⚠ THE SOURCE IS THE LEAD TRACKER, NOT JOBBER INVOICES, and that was a change of
 * mind worth recording because invoices look like the better answer. Measured on the
 * live book: `invoices.salesperson_external_id` is set on 38% of invoices and on
 * only 7 of the 19 Rachio lines, so "who sold it" is unanswerable there, while
 * `leads.salesperson` is set on 706 of 798 leads (and on 409 of the 410 won in
 * 2026). The invoice mirror also starts at the Jobber backfill floor, 2026-01-02,
 * where lead history reaches back to 2025-07-13. Quote line items would be a third
 * candidate and are not mirrored at all.
 *
 * ⚠ The trade this accepts: these are SALES, not fulfilment. A lead marked won for a
 * Rachio is counted whether or not the controller has been installed and invoiced
 * yet, and a controller sold to an existing customer without a Tracker card is
 * invisible. That is the right basis for "how many did Josh sell" and the wrong one
 * for "how many did we bill" — the cards say which they are.
 */

import type { LeadItemsRow } from './sources'
import type { SourceBag, SourceRequest, WidgetConfig, WidgetDef, WindowSpec } from './types'
import type { Tone, WidgetPayload } from './payloads'

/* ── matching ─────────────────────────────────────────────────────────────── */

/**
 * The key two spellings of one product agree on.
 *
 * ⚠⚠ This exists because the same product is typed several ways and a picker that
 * matched exactly would quietly under-report. Live: "IR- Rachio" (9 leads) and
 * "IR - Rachio" (4) are one product, as are "IR- Gold" (20) and "IR - Gold" (8) —
 * selecting one spelling of Rachio answers 4 when the truth is 13, and looks
 * perfectly plausible. Same class of bug as the §8.2 loss reasons, where
 * "Not Sold- Other" and "Not Sold — Other" split the largest reason in two.
 *
 * Only whitespace-around-punctuation and case are collapsed — never words. Two
 * values that differ by a real word ("Rachio 8 Station" vs "Rachio 16 Station")
 * stay distinct, because they ARE distinct, and the picker lets you select both.
 */
export function itemKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s*[-–—/]\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Human label for a stage key, since config stores keys and `tracker_stages.label`
 *  isn't reachable from a pure metric. `closed_won` → "Closed won". */
function stageLabel(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : key
}

const asArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : []

/* ── shared plumbing ─────────────────────────────────────────────────────── */

const BASIS_SOLD = 'When it sold'
const BASIS_CREATED = 'When the lead came in'

const ITEM_CONFIG = {
  values: {
    kind: 'catalog' as const,
    label: 'Which items to count',
    def: [] as string[],
    catalog: 'lead_services' as const,
    hint: 'From the Lead Tracker’s Service column, with how many leads used each. Spellings of the same name (“IR- Rachio” and “IR - Rachio”) are added together for you; tick separate entries to count different things as one item.',
  },
  stages: {
    kind: 'catalog' as const,
    label: 'Counts as sold when the stage is',
    def: ['closed_won'],
    catalog: 'tracker_stages' as const,
    hint: 'Tick Upsells too if an upsell counts as a sale. Untick everything to count every lead that asked, sold or not.',
  },
  basis: {
    kind: 'enum' as const,
    label: 'Date to count it against',
    def: BASIS_SOLD,
    opts: [BASIS_SOLD, BASIS_CREATED],
    hint: 'Sold date answers “what did we sell in July”. Lead date matches the rest of the Sales report.',
  },
}

function itemsReq(cfg: WidgetConfig, win: WindowSpec): SourceRequest {
  const stages = asArray(cfg.stages)
  return {
    source: 'lead_items',
    params: {
      start: win.start,
      end: win.end,
      basis: String(cfg.basis) === BASIS_CREATED ? 'created' : 'sold',
      // Sorted so two widgets ticking the same stages in a different order share
      // one query rather than running the same thing twice.
      stages: [...stages].sort().join(','),
    },
  }
}

function items(bag: SourceBag, cfg: WidgetConfig, win: WindowSpec): LeadItemsRow | null {
  return bag.get<LeadItemsRow>(itemsReq(cfg, win))[0] ?? null
}

type Group = {
  key: string
  /** Most common raw spelling, used as the display name. */
  label: string
  leads: number
  spellings: Set<string>
  bySeller: Map<string, number>
}

/**
 * Fold the source's raw (value, salesperson) rows into one group per selected item.
 *
 * ⚠ A selected item that matched nothing comes back as a group with 0, never as an
 * absent row. "We sold none of these" and "I forgot to tick that one" look identical
 * on a card that simply omits it, and only one of them is worth acting on.
 */
export function groupSelected(row: LeadItemsRow | null, selected: string[]): Group[] {
  const wanted = new Map<string, Group>()
  for (const s of selected) {
    const k = itemKey(s)
    if (!wanted.has(k)) {
      wanted.set(k, { key: k, label: s, leads: 0, spellings: new Set(), bySeller: new Map() })
    }
  }
  const counts = new Map<string, Map<string, number>>()   // key → raw spelling → leads
  for (const r of row?.rows ?? []) {
    const k = itemKey(r.value)
    const g = wanted.get(k)
    if (!g) continue
    g.leads += r.leads
    g.spellings.add(r.value)
    const seller = r.salesperson?.trim() || null
    const name = seller ?? 'No salesperson recorded'
    g.bySeller.set(name, (g.bySeller.get(name) ?? 0) + r.leads)
    const m = counts.get(k) ?? new Map<string, number>()
    m.set(r.value, (m.get(r.value) ?? 0) + r.leads)
    counts.set(k, m)
  }
  // Display name = the spelling that occurs most, so the card reads the way the
  // team writes it rather than however the person building the board happened to tick.
  for (const [k, g] of wanted) {
    const m = counts.get(k)
    if (!m?.size) continue
    g.label = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
  }
  return [...wanted.values()]
}

/** What the card is measuring, in words, every time. */
function basisPhrase(cfg: WidgetConfig): string {
  return String(cfg.basis) === BASIS_CREATED ? 'by lead date' : 'by sold date'
}

function stagePhrase(cfg: WidgetConfig): string {
  const stages = asArray(cfg.stages)
  if (!stages.length) return 'every lead that asked, sold or not'
  return stages.map(stageLabel).join(' + ')
}

/**
 * Caveats that belong on the card rather than in a doc nobody opens.
 *
 * `multi_service` is the fan-out warning: 20 of Heroes' won 2026 leads list more
 * than one service, so per-item counts legitimately sum above the lead count — the
 * same overshoot the per-technician revenue chart states in dollars.
 */
function notes(row: LeadItemsRow | null, win: WindowSpec, sellerSplit: boolean): string[] {
  const out: string[] = []
  const c = row?.coverage
  if (!c) return out
  if (c.earliest && win.start < c.earliest) {
    out.push(`records start ${c.earliest}, so anything before that is missing rather than zero`)
  }
  if (c.no_service > 0) {
    out.push(`${c.no_service} lead${c.no_service === 1 ? '' : 's'} in this period have no Service filled in and can match nothing`)
  }
  if (sellerSplit && c.no_salesperson > 0) {
    out.push(`${c.no_salesperson} had no salesperson recorded`)
  }
  return out
}

/* ── the widgets ─────────────────────────────────────────────────────────── */

const SELLER_TONES: Tone[] = ['good', 'warn', 'mixed', 'neutral', 'bad', 'unknown', 'free', 'paid']

export const TRACKED_ITEM_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'tracked_item_count',
    // Lead Tracker data → answers to the Sales & Pipeline grant, the report that
    // already shows who sold what. Mapping it anywhere wider would let someone
    // read Tracker figures their own reports withhold.
    group: 'Tracked Items',
    title: 'Item Sold — Count',
    blurb: 'How many of one thing you sold, optionally split by who sold it',
    defaultSpan: 3,
    config: {
      ...ITEM_CONFIG,
      label: {
        kind: 'text' as const,
        label: 'Name on the card',
        def: '',
        placeholder: 'e.g. Rachio controllers',
        hint: 'Leave blank to use the item’s own name.',
      },
      split: {
        kind: 'enum' as const,
        label: 'Show',
        def: 'One total',
        opts: ['One total', 'Who sold them'],
      },
    },
    sources: (cfg, win) => [itemsReq(cfg, win)],
    metric: (bag, cfg, win) => {
      const row = items(bag, cfg, win)
      const selected = asArray(cfg.values)
      const groups = groupSelected(row, selected)
      const total = groups.reduce((s, g) => s + g.leads, 0)
      const custom = String(cfg.label ?? '').trim()
      const name = custom || (groups.length === 1 ? groups[0].label : groups.length ? `${groups.length} items` : 'Tracked item')
      const bySeller = String(cfg.split) === 'Who sold them'

      if (!selected.length) {
        return {
          kind: 'kpi',
          label: custom || 'Tracked item',
          value: '—',
          sub: 'Open this card’s settings and pick which Service values to count',
          tone: 'neutral',
        }
      }

      const spellings = groups.reduce((s, g) => s + g.spellings.size, 0)
      const caveats = notes(row, win, bySeller)

      if (bySeller) {
        const merged = new Map<string, number>()
        for (const g of groups) for (const [who, n] of g.bySeller) merged.set(who, (merged.get(who) ?? 0) + n)
        const ranked = [...merged.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        return {
          kind: 'bars',
          title: `${name} — who sold them`,
          sub: `${total} sold ${basisPhrase(cfg)} · ${stagePhrase(cfg)}${caveats.length ? ` · ${caveats.join(' · ')}` : ''}`,
          format: 'number',
          rows: ranked.map(([who, n], i) => ({
            label: who,
            value: n,
            // The unattributed bucket is never dressed as a person.
            tone: who === 'No salesperson recorded' ? 'unknown' : SELLER_TONES[i % SELLER_TONES.length],
          })),
          empty: `Nobody sold ${name} in this period`,
        }
      }

      return {
        kind: 'kpi',
        label: name,
        value: total.toLocaleString(),
        sub: [
          `sold ${basisPhrase(cfg)}`,
          stagePhrase(cfg),
          spellings > 1 ? `${spellings} spellings counted as one` : null,
          ...caveats,
        ].filter(Boolean).join(' · '),
        tone: total > 0 ? 'good' : 'neutral',
      }
    },
  },

  {
    type: 'tracked_items_table',
    group: 'Tracked Items',
    title: 'Items Sold — Table',
    blurb: 'One row per item you track, with the count and the top seller',
    defaultSpan: 6,
    config: ITEM_CONFIG,
    sources: (cfg, win) => [itemsReq(cfg, win)],
    metric: (bag, cfg, win) => {
      const row = items(bag, cfg, win)
      const selected = asArray(cfg.values)
      const groups = groupSelected(row, selected).sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label))
      const total = groups.reduce((s, g) => s + g.leads, 0)
      const caveats = notes(row, win, true)
      const multi = row?.coverage.multi_service ?? 0

      const foot = [
        `${total} sold across ${groups.length} item${groups.length === 1 ? '' : 's'}`,
        // ⚠ The fan-out statement. A lead listing two services counts under both, so
        // these rows can legitimately total more than the number of sales — said here
        // rather than left for someone to discover by adding the column up.
        multi > 0 ? `${multi} lead${multi === 1 ? '' : 's'} in this period list more than one service, so a lead can appear on two rows` : null,
        ...caveats,
      ].filter(Boolean).join(' · ')

      return {
        kind: 'table',
        title: 'Items Sold',
        sub: `${basisPhrase(cfg)} · ${stagePhrase(cfg)}`,
        columns: [
          { key: 'item', label: 'Item', align: 'left' },
          { key: 'sold', label: 'Sold', align: 'right', format: 'number', sortable: true },
          { key: 'top', label: 'Top seller', align: 'left' },
        ],
        rows: groups.map(g => {
          const ranked = [...g.bySeller.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          const top = ranked[0]
          return {
            key: g.key,
            cells: {
              item: g.label,
              sold: g.leads,
              top: top ? (top[1] === g.leads ? top[0] : `${top[0]} (${top[1]})`) : '—',
            },
            tones: { sold: g.leads > 0 ? 'good' : 'neutral' },
            // Only worth saying when it happened, and it explains a count that
            // looks higher than the ticked name suggests.
            meta: g.spellings.size > 1
              ? { text: `${g.spellings.size} spellings: ${[...g.spellings].join(', ')}`, tone: 'neutral' }
              : undefined,
          }
        }),
        foot,
        empty: selected.length
          ? 'None of these sold in this period'
          : 'Open this card’s settings and pick which Service values to count',
      }
    },
  },
]

/**
 * No preset Report placement.
 *
 * Which items a business tracks is a per-tenant choice with no sensible default —
 * a card shipped onto the Sales report would arrive empty for everyone and read as
 * broken. These live in the widget library for custom Scoreboards only, which is
 * exactly the case user-built boards exist for.
 */
