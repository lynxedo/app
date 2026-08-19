/* The widget library.
 *
 * One entry per widget: what it's called, which sources it needs, the pure
 * transform that shapes its data, and the config schema that GENERATES its
 * settings form. Adding a widget is adding one object here plus (if it draws
 * something new) one component — never a bespoke settings screen.
 *
 * This first pass covers the ten widgets that make up Board 8 Lead Sources, the
 * first board being migrated (REPORTS_PRD.md §9.1.7). Eight of the ten read the
 * SAME source, which is the batching case in miniature.
 */

import type { ScorecardRow, DecidedLeadRow } from './sources'
import type { SourceBag, WidgetConfig, WidgetDef, WindowSpec } from './types'
import { RETENTION_WIDGETS, RETENTION_REPORT_PRESET } from './retention'
import { REVENUE_WIDGETS, REVENUE_REPORT_PRESET } from './revenue'
import { CREW_WIDGETS, CREW_REPORT_PRESET } from './crew'
import { COMMS_WIDGETS, COMMS_REPORT_PRESET } from './comms'
import { CLIENTS_WIDGETS, CLIENTS_GEO_WIDGETS, CLIENTS_REPORT_PRESET } from './clients'
import { SERVICE_LINE_WIDGETS, SERVICE_LINE_REPORT_PRESET } from './servicelines'
import { SALES_WIDGETS, SALES_REPORT_PRESET } from './sales'
import { QUOTE_WIDGETS, QUOTE_REPORT_PRESET } from './quotes'
import { HOME_WIDGETS, HOME_REPORT_PRESET } from './home'
import { PEOPLE_WIDGETS, PEOPLE_REPORT_PRESET } from './people'
import { GOALS_WIDGETS, GOALS_REPORT_PRESET } from './goals'
import { REVENUE_TREND_WIDGETS } from './revenuetrend'
import { TRACKED_ITEM_WIDGETS } from './trackeditems'
import { BOOK_WIDGETS, TICKET_WIDGETS } from './book'
import { COMMISSION_WIDGETS } from './commission'
import { NARRATIVE_WIDGETS } from './narrative'
import type { Tone, WidgetPayload } from './payloads'
// Pure map + pure lookup. gating.ts pulls in lib/reports/registry, which is data
// and pure functions only — safe in the browser bundle, and the picker wants the
// report titles anyway to explain what a greyed-out widget needs.
import { widgetReportSlugs } from './gating'

const UNKNOWN_SOURCE = 'Other / Unknown'

/* ── shared, pure helpers ───────────────────────────────────────────────── */

const scorecardReq = (win: WindowSpec) => ({
  source: 'source_scorecard' as const,
  params: { start: win.start, end: win.end },
})

function scorecard(bag: SourceBag, win: WindowSpec): ScorecardRow[] {
  return bag.get<ScorecardRow>(scorecardReq(win))
}

function costTone(costType: string): Tone {
  switch (costType) {
    case 'Paid': return 'paid'
    case 'Free': return 'free'
    case 'Mixed': return 'mixed'
    default: return 'unknown'
  }
}

/** Retention colour thresholds — unchanged from today's Board 8. */
function retentionTone(pct: number | null): Tone {
  if (pct == null) return 'neutral'
  return pct >= 90 ? 'good' : pct >= 80 ? 'warn' : 'bad'
}

/**
 * Share of the recurring book whose lead source is actually known.
 *
 * ⚠ This CORRECTS the hardcoded board, which counted only customers whose source
 * resolved to NULL (`unresolved_count`) and ignored everyone explicitly filed
 * under "Other / Unknown". For Heroes on 2026-08-10 the old formula read 98.7%
 * while 99 of 373 recurring customers sat in that bucket — the card claimed
 * near-total attribution of a book that is roughly three-quarters attributed.
 * Correct figure: 73.5%. So the migrated Board 8 shows a LOWER coverage number
 * than ?classic=1, and that is the intended difference; nothing else moved.
 *
 * The two counts overlap — every NULL-source customer is itself bucketed into
 * "Other / Unknown", so naively subtracting both double-counts them (which is how
 * a first pass at this produced a wrong 72.1%). Count the bucket, then add only
 * unresolved customers attributed OUTSIDE it.
 */
function coveragePct(rows: ScorecardRow[]): number {
  const total = rows.reduce((s, r) => s + r.total_customers, 0)
  if (total <= 0) return 0
  const unknownBucket = rows
    .filter(r => r.source === UNKNOWN_SOURCE)
    .reduce((s, r) => s + r.total_customers, 0)
  const strayUnresolved = rows
    .filter(r => r.source !== UNKNOWN_SOURCE)
    .reduce((s, r) => s + r.unresolved_count, 0)
  const known = Math.max(0, total - unknownBucket - strayUnresolved)
  return Math.round((1000 * known) / total) / 10
}

/** Sources with a big enough sample to rank honestly, Unknown excluded. */
function ranked(rows: ScorecardRow[], minSample: number): ScorecardRow[] {
  return rows.filter(r => r.source !== UNKNOWN_SOURCE && r.total_customers >= minSample && r.retention_pct != null)
}

function newTotal(rows: ScorecardRow[]): number {
  return rows.reduce((s, r) => s + r.new_in_year, 0)
}

function groupRetention(rows: ScorecardRow[]): number | null {
  const total = rows.reduce((s, r) => s + r.total_customers, 0)
  const active = rows.reduce((s, r) => s + r.active_count, 0)
  return total > 0 ? Math.round((1000 * active) / total) / 10 : null
}

/* ── widget definitions ─────────────────────────────────────────────────── */

const WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'kpi_new_customers',
    group: 'Marketing',
    title: 'New Recurring Customers',
    blurb: 'Single number for the period',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [scorecardReq(win)],
    metric: (bag, _cfg, win) => ({
      kind: 'kpi',
      label: 'New Recurring Customers',
      value: newTotal(scorecard(bag, win)).toLocaleString(),
      sub: `Sold in ${win.phrase}`,
    }),
  },

  {
    type: 'kpi_paid_share',
    group: 'Marketing',
    title: 'Paid Share of New',
    blurb: 'Percent of new customers that cost money to acquire',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [scorecardReq(win)],
    metric: (bag, _cfg, win) => {
      const rows = scorecard(bag, win)
      const total = newTotal(rows)
      const paid = rows.filter(r => r.cost_type === 'Paid').reduce((s, r) => s + r.new_in_year, 0)
      const free = rows.filter(r => r.cost_type === 'Free').reduce((s, r) => s + r.new_in_year, 0)
      const pct = total > 0 ? Math.round((100 * paid) / total) : 0
      return {
        kind: 'kpi',
        label: 'Paid Share of New',
        value: `${pct}% paid`,
        sub: total > 0
          ? `${paid} paid · ${free} free/referral of ${total} new`
          : 'No new recurring customers in this period',
      }
    },
  },

  {
    type: 'kpi_best_source',
    group: 'Marketing',
    title: 'Best-Retaining Source',
    blurb: 'Leader, with its sample size',
    defaultSpan: 3,
    config: {
      minSample: { kind: 'number', label: 'Minimum sample', def: 5, min: 1, max: 50, unit: 'customers',
        hint: 'Guards against a source with two lucky customers topping the list.' },
    },
    sources: (_cfg, win) => [scorecardReq(win)],
    metric: (bag, cfg, win) => {
      const min = Number(cfg.minSample)
      const best = ranked(scorecard(bag, win), min)
        .sort((a, b) => (b.retention_pct ?? 0) - (a.retention_pct ?? 0))[0]
      return {
        kind: 'kpi',
        label: 'Best-Retaining Source',
        value: best ? best.source : '—',
        tone: best ? 'good' : 'neutral',
        sub: best
          ? `${best.retention_pct}% retained · ${best.total_customers} customers`
          : `No source has ${min} or more customers yet`,
      }
    },
  },

  {
    /**
     * ⚠ The ONE number that deliberately differs from the hardcoded board — it is
     * a fix, not a migration artefact. See coveragePct() above for why 98.7%
     * became 73.5%, and REPORTS_PRD.md §9.1.8.
     */
    type: 'kpi_source_coverage',
    group: 'Marketing',
    title: 'Source Coverage',
    blurb: 'Share of the book with a known lead source',
    defaultSpan: 3,
    config: {},
    sources: (_cfg, win) => [scorecardReq(win)],
    metric: (bag, _cfg, win) => {
      const pct = coveragePct(scorecard(bag, win))
      return {
        kind: 'kpi',
        label: 'Source Coverage',
        value: `${pct}%`,
        tone: pct >= 85 ? 'good' : pct >= 65 ? 'warn' : 'bad',
        sub: 'Share of the book with a known lead source',
      }
    },
  },

  {
    type: 'new_by_source',
    group: 'Marketing',
    title: 'New Customers by Source',
    blurb: 'Ranked bars, coloured by cost type',
    defaultSpan: 4,
    config: {
      topN: { kind: 'number', label: 'Show top', def: 8, min: 3, max: 20, unit: 'sources' },
      costTypes: { kind: 'multi', label: 'Cost types', def: ['Paid', 'Free', 'Mixed', 'Unknown'],
        opts: ['Paid', 'Free', 'Mixed', 'Unknown'] },
    },
    sources: (_cfg, win) => [scorecardReq(win)],
    metric: (bag, cfg, win) => {
      const allow = cfg.costTypes as string[]
      const rows = scorecard(bag, win)
        .filter(r => allow.includes(r.cost_type) && r.new_in_year > 0)
        .sort((a, b) => b.new_in_year - a.new_in_year)
        .slice(0, Number(cfg.topN))
      return {
        kind: 'bars',
        title: 'New Customers by Source',
        sub: `${win.label} · recurring services sold`,
        format: 'number',
        rows: rows.map(r => ({ label: r.source, value: r.new_in_year, tone: costTone(r.cost_type) })),
        empty: 'No new recurring customers match these filters',
      }
    },
  },

  {
    type: 'retention_by_source',
    group: 'Marketing',
    title: 'Retention by Source',
    blurb: 'Who keeps the customers they bring',
    defaultSpan: 4,
    config: {
      minSample: { kind: 'number', label: 'Minimum sample', def: 3, min: 1, max: 50, unit: 'customers' },
      hideUnknown: { kind: 'bool', label: 'Hide Other / Unknown', def: true,
        hint: 'Unknown is a mixed bag, not a channel.' },
    },
    sources: (_cfg, win) => [scorecardReq(win)],
    metric: (bag, cfg, win) => {
      const min = Number(cfg.minSample)
      const rows = scorecard(bag, win)
        .filter(r => r.total_customers >= min && r.retention_pct != null)
        .filter(r => !(cfg.hideUnknown === true && r.source === UNKNOWN_SOURCE))
        .sort((a, b) => (b.retention_pct ?? 0) - (a.retention_pct ?? 0))
      return {
        kind: 'bars',
        title: 'Retention by Source',
        sub: `Sources with ${min} or more recurring customers`,
        format: 'percent',
        rows: rows.map(r => ({
          label: r.source,
          value: r.retention_pct ?? 0,
          tone: retentionTone(r.retention_pct),
          detail: `${r.active_count} active / ${r.churned_count} lost of ${r.total_customers}`,
        })),
        empty: 'Not enough attributed customers yet',
      }
    },
  },

  {
    type: 'close_rate_by_source',
    group: 'Marketing',
    title: 'Close Rate by Source',
    blurb: 'Won vs lost, from the Lead Tracker',
    defaultSpan: 4,
    config: {
      // 8 matches what the hardcoded board shows today; the migrated board has to
      // agree with the one it replaces before anyone trusts it.
      topN: { kind: 'number', label: 'Show top', def: 8, min: 3, max: 20, unit: 'sources' },
    },
    sources: (_cfg, win) => [{ source: 'leads_decided', params: { start: win.start, end: win.end } }],
    metric: (bag, cfg, win) => {
      const leads = bag.get<DecidedLeadRow>({ source: 'leads_decided', params: { start: win.start, end: win.end } })
      const agg: Record<string, { won: number; lost: number }> = {}
      for (const l of leads) {
        if (l.stage !== 'closed_won' && l.stage !== 'closed_lost') continue
        const src = (l.lead_source || '').trim() || UNKNOWN_SOURCE
        const slot = (agg[src] ??= { won: 0, lost: 0 })
        if (l.stage === 'closed_won') slot.won++
        else slot.lost++
      }
      const rows = Object.entries(agg)
        .map(([label, c]) => ({ label, ...c, decided: c.won + c.lost }))
        .sort((a, b) => b.decided - a.decided)
        .slice(0, Number(cfg.topN))
      return {
        kind: 'stacked',
        title: 'Close Rate by Source',
        sub: `Lead Tracker · leads created in ${win.phrase}`,
        rows: rows.map(r => ({
          label: r.label,
          caption: `${Math.round((100 * r.won) / r.decided)}%`,
          parts: [
            { value: r.won, tone: 'good' as Tone, label: 'Closed won' },
            { value: r.lost, tone: 'bad' as Tone, label: 'Closed lost' },
          ],
        })),
        legend: [{ label: 'Closed won', tone: 'good' }, { label: 'Closed lost', tone: 'bad' }],
        empty: 'No decided leads in this period',
      }
    },
  },

  {
    type: 'paid_free_mix',
    group: 'Marketing',
    title: 'Paid vs Free Mix',
    blurb: 'Acquisition mix by cost type',
    defaultSpan: 12,
    config: {},
    sources: (_cfg, win) => [scorecardReq(win)],
    metric: (bag, _cfg, win) => {
      const rows = scorecard(bag, win)
      const mix: Record<string, number> = {}
      for (const r of rows) mix[r.cost_type] = (mix[r.cost_type] ?? 0) + r.new_in_year
      const parts = Object.entries(mix)
        .filter(([, n]) => n > 0)
        .map(([label, value]) => ({ label, value, tone: costTone(label) }))
      return {
        kind: 'donut',
        title: 'Paid vs Free — New Customers',
        sub: `${win.label} · acquisition mix by cost type`,
        parts,
        note: 'Free and referral customers cost nothing to acquire and historically retain best — every point of mix shifted out of Paid is margin.',
        empty: 'No new customers in this period',
      }
    },
  },

  {
    type: 'source_scorecard_table',
    group: 'Marketing',
    title: 'Lead-Source Scorecard',
    blurb: 'Volume, value and loyalty — one row per source',
    defaultSpan: 12,
    config: {
      sortBy: { kind: 'enum', label: 'Sort by', def: 'Customers',
        opts: ['Customers', 'Retention', 'New', 'Active $/yr', 'Tenure', 'Est. LTV'] },
      hideUnknown: { kind: 'bool', label: 'Hide Other / Unknown', def: false },
    },
    sources: (_cfg, win) => [scorecardReq(win)],
    metric: (bag, cfg, win) => {
      const sortKeys: Record<string, keyof ScorecardRow> = {
        'Customers': 'total_customers',
        'Retention': 'retention_pct',
        'New': 'new_in_year',
        'Active $/yr': 'active_annual_value',
        'Tenure': 'avg_tenure_months',
        'Est. LTV': 'est_ltv',
      }
      const key = sortKeys[String(cfg.sortBy)] ?? 'total_customers'
      const rows = scorecard(bag, win)
        .filter(r => !(cfg.hideUnknown === true && r.source === UNKNOWN_SOURCE))
        .slice()
        .sort((a, b) => (Number(b[key] ?? -1)) - (Number(a[key] ?? -1)))
      return {
        kind: 'table',
        title: 'Lead-Source Scorecard',
        sub: `Volume, value and loyalty · ${win.label}`,
        columns: [
          { key: 'source', label: 'Source', align: 'left' },
          { key: 'total', label: 'Customers', align: 'right', sortable: true,
            title: 'Recurring customers attributed to this source' },
          { key: 'active', label: 'Active', align: 'right' },
          { key: 'lost', label: 'Lost', align: 'right' },
          { key: 'retention', label: 'Retention', align: 'right', format: 'percent', sortable: true,
            title: "Share of this source's customers still active" },
          { key: 'new', label: 'New', align: 'right', sortable: true },
          { key: 'annual', label: 'Active $/yr', align: 'right', format: 'currency', sortable: true },
          { key: 'tenure', label: 'Tenure', align: 'right', format: 'months', sortable: true },
          { key: 'ltv', label: 'Est. LTV', align: 'right', format: 'currency', sortable: true },
        ],
        rows: rows.map(r => ({
          key: r.source,
          cells: {
            source: r.source,
            total: r.total_customers,
            active: r.active_count,
            lost: r.churned_count,
            retention: r.retention_pct,
            new: r.new_in_year,
            annual: r.active_annual_value,
            tenure: r.avg_tenure_months,
            ltv: r.est_ltv,
          },
          tones: {
            retention: retentionTone(r.retention_pct),
            lost: r.churned_count > 0 ? 'bad' : 'neutral',
          },
          meta: { text: `${r.cost_type} · ${r.source_group}`, tone: costTone(r.cost_type) },
        })),
        foot: 'Universe: the recurring book for this period. Retention is the share still active — young sources flatter themselves, so read it beside tenure. Est. LTV = average annual value × average tenure.',
        empty: 'No attributed customers yet',
      }
    },
  },

  {
    type: 'source_insights',
    group: 'Marketing',
    title: 'What the Numbers Say',
    blurb: 'Plain-language read of the lead-source picture',
    defaultSpan: 12,
    config: {},
    sources: (_cfg, win) => [scorecardReq(win)],
    metric: (bag, _cfg, win) => {
      const rows = scorecard(bag, win)
      const rated = ranked(rows, 5)
      const best = [...rated].sort((a, b) => (b.retention_pct ?? 0) - (a.retention_pct ?? 0))[0] ?? null
      const worst = [...rated].sort((a, b) => (a.retention_pct ?? 0) - (b.retention_pct ?? 0))[0] ?? null
      const items: string[] = []

      if (best) {
        items.push(`Best-retaining source: ${best.source} — ${best.retention_pct}% of its ${best.total_customers} recurring customers are still active.`)
      }
      if (worst && best && worst.source !== best.source) {
        items.push(`Weakest: ${worst.source} — ${worst.retention_pct}% retained (${worst.churned_count} of ${worst.total_customers} cancelled).`)
      }
      const refRate = groupRetention(rows.filter(r => r.source_group === 'Referral / Relationship'))
      const paidRate = groupRetention(rows.filter(r => r.cost_type === 'Paid'))
      if (refRate != null && paidRate != null) {
        items.push(`Referral and repeat customers retain at ${refRate}% vs ${paidRate}% for paid lead sources.`)
      }
      // Deliberately the same four lines the hardcoded board writes, in the same
      // order. An extra insight here would make the migrated board visibly differ
      // from the one it replaces and invite doubt about the numbers; new lines can
      // come after the migration is trusted.
      const unknownCount = rows
        .filter(r => r.source === UNKNOWN_SOURCE)
        .reduce((s, r) => s + r.total_customers, 0)
      items.push(
        `Lead source is known for ${coveragePct(rows)}% of the book — ${unknownCount.toLocaleString()} customers read Other/Unknown.`,
      )

      return { kind: 'list', title: 'What the Numbers Say', sub: `Read of ${win.label}`, items, empty: 'Nothing to report yet' }
    },
  },
]

/** Every widget in the library. One array per subject area, concatenated here. */
const ALL_WIDGETS: WidgetDef<WidgetPayload>[] = [...WIDGETS, ...RETENTION_WIDGETS, ...REVENUE_WIDGETS, ...CREW_WIDGETS, ...COMMS_WIDGETS, ...CLIENTS_WIDGETS, ...CLIENTS_GEO_WIDGETS, ...SERVICE_LINE_WIDGETS, ...SALES_WIDGETS, ...QUOTE_WIDGETS, ...HOME_WIDGETS, ...PEOPLE_WIDGETS, ...GOALS_WIDGETS, ...REVENUE_TREND_WIDGETS, ...TRACKED_ITEM_WIDGETS, ...BOOK_WIDGETS, ...TICKET_WIDGETS, ...COMMISSION_WIDGETS, ...NARRATIVE_WIDGETS]

const BY_TYPE = new Map(ALL_WIDGETS.map(w => [w.type, w]))

// A duplicate type would make one widget silently unreachable, and the layout rows
// that point at it would render the wrong card. Cheaper to fail at import.
if (BY_TYPE.size !== ALL_WIDGETS.length) {
  const seen = new Set<string>()
  const dupes = ALL_WIDGETS.map(w => w.type).filter(t => seen.size === seen.add(t).size)
  throw new Error(`Duplicate widget type(s) in the registry: ${[...new Set(dupes)].join(', ')}`)
}

/* Exactly one of `metric` / `narrate` — the resolver branches on which, and a def
 * with neither would render as a permanently broken card while a def with both would
 * compute a payload in pass 3 and silently throw it away in pass 4. Asserted at
 * import for the same reason as the duplicate check above: this is a mistake made
 * once, while writing a widget, and it costs nothing to catch there. */
{
  const wrong = ALL_WIDGETS.filter(w => (!!w.metric) === (!!w.narrate))
  if (wrong.length) {
    throw new Error(`Widget(s) must declare exactly one of metric / narrate: ${wrong.map(w => w.type).join(', ')}`)
  }
  const fetching = NARRATIVE_WIDGETS.filter(w => w.sources)
  if (fetching.length) {
    // The whole safety argument for the second pass is that a narrator reads only
    // what other cards already fetched. One that declared a source of its own would
    // quietly break that.
    throw new Error(`A narrating widget must declare no sources: ${fetching.map(w => w.type).join(', ')}`)
  }
}

export function getWidgetDef(type: string): WidgetDef<WidgetPayload> | null {
  return BY_TYPE.get(type) ?? null
}

export function allWidgetDefs(): WidgetDef<WidgetPayload>[] {
  return ALL_WIDGETS
}

/** Picker metadata — no metric/source functions, safe to send to the browser. */
export type WidgetCatalogEntry = {
  type: string
  group: string
  title: string
  blurb: string
  defaultSpan: number
  config: WidgetDef['config']
  requires?: string
  /**
   * Reports whose data this widget shows — the entitlement for putting it on a
   * custom Scoreboard, and for seeing it on someone else's. Computed here rather
   * than in the browser so the group→report map never ships to the client.
   */
  reports: string[]
}

export function widgetCatalog(): WidgetCatalogEntry[] {
  return ALL_WIDGETS.map(w => ({
    type: w.type,
    group: w.group,
    title: w.title,
    blurb: w.blurb,
    defaultSpan: w.defaultSpan,
    config: w.config,
    requires: w.requires,
    reports: widgetReportSlugs(w.type, w.group, REPORT_PRESETS),
  }))
}

/** Every group present in the library, for the completeness assertion in ./layouts.ts. */
export function widgetGroups(): string[] {
  return [...new Set(ALL_WIDGETS.map(w => w.group))]
}

/**
 * The reports one widget reads. Server-side helper for the save/resolve gate; the
 * browser gets the same answer pre-computed on the catalog entry.
 */
export function reportsForWidget(type: string): string[] {
  const def = BY_TYPE.get(type)
  // Unknown type → no reports → `canUseWidget` refuses it. Failing closed is
  // right: an orphaned widget from a renamed registry entry should not become
  // placeable by everyone.
  if (!def) return []
  return widgetReportSlugs(def.type, def.group, REPORT_PRESETS)
}

/**
 * Boards that render from a widget layout instead of a hardcoded view.
 *
 * ⚠ Lives HERE, not in ./layouts.ts, because two entry points need to agree and
 * one of them is a client component: the route (app/hub/scoreboards/[slug]) and
 * the Workspace-Tabs twin (components/hub/workspace/ScoreboardsTab). layouts.ts
 * imports the service-role Supabase client, so a client component can't ask it.
 * Getting this wrong is invisible in the route and shows up only in a tab — which
 * is exactly how the first attempt shipped a board that still looked old.
 */
export const WIDGET_BOARD_SLUGS: readonly string[] = ['8']

export function hasWidgetLayout(slug: string): boolean {
  return WIDGET_BOARD_SLUGS.includes(slug)
}

/**
 * Preset REPORTS — locked arrangements we ship (§0.1: a Report is preset, a
 * Scoreboard is customizable). Keyed by the layout slug, namespaced `report:` so a
 * report can never collide with a board slug ('1'…'8') in scoreboard_layouts.
 */
/**
 * §8.9 Marketing & Lead Source, as a preset Report.
 *
 * ⚠ Cost per lead / CAC / ROAS are absent on purpose: §8.9 lists them, but they
 * need ad spend, which nothing in the product captures yet. A cost-per-lead
 * computed without spend would be a made-up number wearing a real label.
 */
export const MARKETING_REPORT_PRESET: { type: string; span: number; config?: WidgetConfig }[] = [
  { type: 'kpi_new_customers', span: 3 },
  { type: 'kpi_best_source', span: 3 },
  { type: 'kpi_paid_share', span: 3 },
  { type: 'kpi_source_coverage', span: 3 },
  { type: 'source_insights', span: 12 },
  { type: 'source_scorecard_table', span: 12 },
  { type: 'new_by_source', span: 4 },
  { type: 'close_rate_by_source', span: 4 },
  { type: 'retention_by_source', span: 4 },
  { type: 'paid_free_mix', span: 12 },
  { type: 'geo_revenue_by_zip', span: 12 },
]

export const REPORT_PRESETS: Record<string, { title: string; widgets: { type: string; span: number; config?: WidgetConfig }[] }> = {
  'report:retention': { title: 'Retention & Churn', widgets: RETENTION_REPORT_PRESET },
  'report:revenue': { title: 'Revenue & Invoicing', widgets: REVENUE_REPORT_PRESET },
  'report:crew': { title: 'Crew & Labor Efficiency', widgets: CREW_REPORT_PRESET },
  'report:communications': { title: 'Communications', widgets: COMMS_REPORT_PRESET },
  'report:clients': { title: 'Clients', widgets: CLIENTS_REPORT_PRESET },
  'report:service-lines': { title: 'Service Line Profitability', widgets: SERVICE_LINE_REPORT_PRESET },
  // Quotes are appended rather than interleaved: the Lead Tracker funnel is the
  // established top of the page, and the quote half is a second, separate funnel (they
  // are deliberately NOT stitched — see quotes.ts).
  'report:sales': { title: 'Sales & Pipeline', widgets: [...SALES_REPORT_PRESET, ...QUOTE_REPORT_PRESET] },
  'report:home': { title: 'Home', widgets: HOME_REPORT_PRESET },
  'report:people': { title: 'People Performance', widgets: PEOPLE_REPORT_PRESET },
  /*
   * §8.9 — the same widget library Board 8 renders, arranged as a Report.
   *
   * Deliberately NOT a new set of widgets. `source_scorecard` has run through
   * `scoreboard_source_scorecard_range` since Aug 10, so every one of these
   * already honours the date picker — the Report needs no new query and cannot
   * disagree with the board it shares its widgets with. The scorecard leads
   * because it is the page's whole argument; the three comparison charts follow
   * it, and the ZIP map answers "where" from the Clients source.
   */
  'report:marketing': { title: 'Marketing & Lead Source', widgets: MARKETING_REPORT_PRESET },
  'report:goals': { title: 'Goals & Targets', widgets: GOALS_REPORT_PRESET },
}

export function reportLayoutSlug(reportSlug: string): string {
  return `report:${reportSlug}`
}

export function hasReportLayout(reportSlug: string): boolean {
  return reportLayoutSlug(reportSlug) in REPORT_PRESETS
}

/** The preset arrangement Board 8 ships with — the board as it looks today. */
export const BOARD_8_PRESET: { type: string; span: number; config?: WidgetConfig }[] = [
  { type: 'kpi_new_customers', span: 3 },
  { type: 'kpi_paid_share', span: 3 },
  { type: 'kpi_best_source', span: 3 },
  { type: 'kpi_source_coverage', span: 3 },
  { type: 'source_insights', span: 12 },
  { type: 'source_scorecard_table', span: 12 },
  { type: 'new_by_source', span: 4 },
  { type: 'retention_by_source', span: 4 },
  { type: 'close_rate_by_source', span: 4 },
  { type: 'paid_free_mix', span: 12 },
]
