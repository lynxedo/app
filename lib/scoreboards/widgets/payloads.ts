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
}

export type StackedPayload = {
  kind: 'stacked'
  title: string
  sub: string
  rows: { label: string; caption: string; parts: { value: number; tone: Tone; label: string }[] }[]
  legend: { label: string; tone: Tone }[]
  empty?: string
}

export type DonutPayload = {
  kind: 'donut'
  title: string
  sub: string
  parts: { label: string; value: number; tone: Tone }[]
  note?: string
  empty?: string
}

export type TableColumn = {
  key: string
  label: string
  align: 'left' | 'right'
  format?: ValueFormat
  /** Column the user may sort by; the resolver does the initial sort. */
  sortable?: boolean
  title?: string
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
}

export type ListPayload = {
  kind: 'list'
  title: string
  sub: string
  items: string[]
  empty?: string
}

export type WidgetPayload =
  | KpiPayload | BarsPayload | StackedPayload | DonutPayload | TablePayload | ListPayload
