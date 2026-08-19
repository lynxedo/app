/* What a metric hands to a component.
 *
 * Metrics emit TONE NAMES, never hex. The client maps a tone to a colour, so a
 * theme change (or a colour-blind-safe palette later) is one map, not a sweep
 * through every widget. This is the same reason the display-formatting layer
 * lives in lib/format.ts rather than in each screen.
 */

import { formatCurrency } from '@/lib/format'

/** Semantic colour roles. Separate from the UI accent by design. */
export type Tone =
  | 'good' | 'warn' | 'bad' | 'neutral'
  | 'paid' | 'free' | 'mixed' | 'unknown'

export type ValueFormat = 'number' | 'percent' | 'currency' | 'months'

export type KpiPayload = {
  kind: 'kpi'
  label: string
  value: string
  sub?: string
  tone?: Tone
  /**
   * True when this tile's `tone` is a verdict the COMPANY would recognise — safe for
   * the board narrator to repeat as a finding.
   *
   * ⚠⚠ TWO ROUNDS OF GETTING THIS WRONG, both worth keeping. First the narrator read
   * `tone` directly and reported "Flagged: Commission Owed $7,299" (amber because
   * commission is money you owe) and "Reading well: WF Annual Value $284,288" (green
   * because a book is a good thing to have). So this flag was added, set wherever the
   * tone was COMPUTED from the tile's own value — and Ben immediately asked why the
   * card was calling out a 14.9% add-on attach rate. Because `pct >= 25 ? 'good' :
   * pct >= 10 ? 'warn'` is a threshold NOBODY AT THE COMPANY CHOSE. Computed is not
   * the same as defensible.
   *
   * ⚠⚠ THE RULE, therefore: set this only where the tone turns on a FACT — something
   * either happened or it did not (a text failed, a voicemail is unheard, money is
   * past due, an approved quote was never converted) — or on a comparison against
   * something the company itself set (a target) or its own measured average. A
   * comparison against a non-zero number picked by a developer is an opinion the
   * product has no standing to assert, and the narrator must not launder it into a
   * sentence. Asserted mechanically in the test suite.
   *
   * ⚠ A tile keeps its colour either way — this governs only whether the narrative
   * SPEAKS for it. The way to make the narrative flag a figure is to set a target for
   * it, which is what Goals & Targets is for.
   *
   * ⚠ Absent means "read nothing into the colour", so a tile that forgets this is
   * left out rather than described wrongly. Fail closed: a card that invents a problem
   * in front of the owner is far worse than one that stays quiet.
   */
  judged?: boolean
  /**
   * Change against the immediately-preceding window of the same length.
   *
   * Optional, and OMITTED rather than zeroed when there is nothing honest to
   * compare against — a prior window that predates the data floor would read as a
   * collapse instead of an absence. `text` carries the reason in that case.
   */
  delta?: { pct: number | null; text: string; tone: Tone }
  /** Small trend shape. Values only; the renderer scales them. */
  spark?: number[]
  /** Opens the full row list behind this figure (see lib/reports/drilldowns.ts). */
  drill?: DrillLink
}

/**
 * The Needs Attention band — the actionable half of Home.
 *
 * Chips, not a chart: each one is a count or an amount that someone should do
 * something about today, and `href` takes them where the doing happens. A chip
 * with nothing to report still renders (at zero, in a calm tone) so "nothing is
 * late" is visibly true rather than indistinguishable from a broken widget.
 */
export type AttentionPayload = {
  kind: 'attention'
  title: string
  sub: string
  chips: {
    key: string
    label: string
    value: string
    detail?: string
    tone: Tone
    href?: string
  }[]
  foot?: string
}

export type BarsPayload = {
  kind: 'bars'
  title: string
  sub: string
  format: ValueFormat
  rows: { label: string; value: number; tone: Tone; detail?: string }[]
  /** Shown instead of the chart when there is nothing to draw. */
  empty?: string
  legend?: { label: string; tone: Tone }[]
  /** Opens the full row list behind this chart (see lib/reports/drilldowns.ts). */
  drill?: DrillLink
}

export type StackedPayload = {
  kind: 'stacked'
  title: string
  sub: string
  rows: { label: string; caption: string; parts: { value: number; tone: Tone; label: string }[] }[]
  legend: { label: string; tone: Tone }[]
  empty?: string
  /**
   * How to render a segment's own value in its hover tooltip. The row `caption`
   * is already formatted by the widget; the tooltip was not, so hovering a
   * revenue segment showed a bare number where every other figure on the card
   * showed dollars.
   */
  format?: ValueFormat
  /**
   * How the bars are scaled.
   *
   * `'share'` (the default, and what every widget written before this existed
   * assumes) stretches each bar to full width, so it answers "what was the MIX in
   * this period" — cancellations by month, calls by day.
   *
   * `'magnitude'` scales each bar against the largest row, so length carries the
   * value and the segments carry the mix. That is what a revenue-over-time chart
   * needs: normalising each month to 100% would hide the seasonality entirely and
   * make a $24k August look identical to a $72k March.
   *
   * Absent = 'share', so adding this changed no existing widget.
   */
  scale?: 'share' | 'magnitude'
  /** Opens the full row list behind this chart (see lib/reports/drilldowns.ts). */
  drill?: DrillLink
}

export type DonutPayload = {
  kind: 'donut'
  title: string
  sub: string
  /**
   * How to render each slice's value in the legend.
   *
   * ⚠ Absent used to be the ONLY behaviour, and the legend printed the raw number
   * — so the annual-value program mix read "Root Rot Recovery (164333.28)" and, on
   * a slice whose value came out of floating-point arithmetic, "(75973.43999999999)".
   * A dollar figure has to look like one. Absent still means a plain count, which
   * is what every other donut here shows.
   */
  format?: ValueFormat
  parts: { label: string; value: number; tone: Tone }[]
  note?: string
  empty?: string
  /** Opens the full row list behind this chart (see lib/reports/drilldowns.ts). */
  drill?: DrillLink
}

/**
 * Turns a table cell into a link to the record it names.
 *
 * The href lives in a row cell rather than on the column, because it differs per
 * row; the column only says WHICH cell holds it. That cell is not itself a column,
 * so it never renders, never sorts, and never reaches the Excel export.
 *
 * Per-cell rather than per-row on purpose: one row can point at two different
 * places — the customer's file for calling them, the quote in Jobber for resending
 * it — and a whole-row hit area would have to pick one and would fire whenever
 * somebody meant to select text.
 */
export type CellLink = {
  /** Row cell key holding the href. */
  hrefKey: string
  /** Outside Lynxedo (Jobber). Opens in a new tab, marked with an arrow. */
  external?: boolean
}

export type TableColumn = {
  key: string
  label: string
  align: 'left' | 'right'
  format?: ValueFormat
  /** Column the user may sort by; the resolver does the initial sort. */
  sortable?: boolean
  title?: string
  /** Renders this cell as a link. See CellLink. */
  link?: CellLink
}

export type TablePayload = {
  kind: 'table'
  title: string
  sub: string
  columns: TableColumn[]
  rows: {
    key: string
    cells: Record<string, string | number | null>
    /** Per-cell tone, e.g. retention green/amber/red. */
    tones?: Record<string, Tone>
    /** Small line under the first cell. */
    meta?: { text: string; tone: Tone }
  }[]
  foot?: string
  empty?: string
  /** Opens the full row list behind this card (see lib/reports/drilldowns.ts). */
  drill?: DrillLink
}

/**
 * A link from a figure to the records that make it up.
 *
 * Kept as a plain href rather than a drill key so the widget library stays
 * independent of the Reports drill-down registry — Scoreboards use the same
 * payloads and must not inherit a Reports-only concept.
 */
export type DrillLink = {
  href: string
  /** Defaults to "See the rows" where a widget doesn't set one. */
  label?: string
}

export type ListPayload = {
  kind: 'list'
  title: string
  sub: string
  items: string[]
  empty?: string
  /** Opens the full row list behind this chart (see lib/reports/drilldowns.ts). */
  drill?: DrillLink
}

/**
 * A read of a whole board, in sections.
 *
 * ⚠ Not a `list`. The nine domain insight cards each answer one question, so a flat
 * run of bullets is right for them. This one answers three at once — how the targets
 * are going, what went well, what is worth a look — and a reader has to be able to
 * find the section they came for without reading all of it. Ben asked for those three
 * headings by name.
 *
 * A section with nothing to say still renders, carrying `empty`: "no target was
 * missed" is a result, and hiding the heading makes it indistinguishable from a
 * narrator that could not read that part of the board.
 */
export type NarrativePayload = {
  kind: 'narrative'
  title: string
  sub: string
  sections: {
    key: string
    heading: string
    /** Colours the heading and the bullets that don't override it. */
    tone: Tone
    lines: { text: string; tone?: Tone }[]
    empty?: string
  }[]
  /** What the narrator could NOT read — see the widget's own header. */
  foot?: string
}

/**
 * A map of circles, one per area, sized and coloured by a single measure.
 *
 * Circles at ZIP centre points rather than shaded ZIP boundaries: boundary polygons
 * are a paid Mapbox entitlement and a large data file, and at a glance the two read
 * the same. `note` carries anything the map could NOT place, so an area we hold
 * customers in but cannot draw is stated rather than silently missing.
 */
export type GeoPayload = {
  kind: 'geo'
  title: string
  sub: string
  /** How to render each point's value in the legend and tooltips. */
  format?: 'currency' | 'number'
  points: {
    id: string
    lat: number
    lng: number
    /** Drives circle size and colour. */
    value: number
    /** Shown in the tooltip, e.g. "12 customers". */
    detail?: string
  }[]
  note?: string
  empty?: string
  /** Opens the full row list behind this map (see lib/reports/drilldowns.ts). */
  drill?: DrillLink
}

/**
 * Render a payload value in its declared units.
 *
 * ⚠ Lives here, beside the types, rather than in the renderer — the board narrator
 * quotes figures out of chart payloads, and a second copy of this in `lib` that
 * drifted from the client's would put a differently-formatted version of the same
 * number in the sentence above the chart. The client's `formatValue` delegates here.
 */
export function formatPayloadValue(v: number | string | null | undefined, format: ValueFormat | undefined): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') return v
  switch (format) {
    case 'percent': return `${v}%`
    case 'currency': return formatCurrency(v)
    case 'months': return `${v} mo`
    default: return v.toLocaleString()
  }
}

export type WidgetPayload =
  | KpiPayload | BarsPayload | StackedPayload | DonutPayload | TablePayload | ListPayload
  | AttentionPayload | GeoPayload | NarrativePayload
