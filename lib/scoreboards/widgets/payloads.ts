/* What a metric hands to a component.
 *
 * Metrics emit TONE NAMES, never hex. The client maps a tone to a colour, so a
 * theme change (or a colour-blind-safe palette later) is one map, not a sweep
 * through every widget. This is the same reason the display-formatting layer
 * lives in lib/format.ts rather than in each screen.
 */

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

export type WidgetPayload =
  | KpiPayload | BarsPayload | StackedPayload | DonutPayload | TablePayload | ListPayload
  | AttentionPayload | GeoPayload
