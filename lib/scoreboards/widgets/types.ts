/* Widget framework — the contract every Scoreboard widget is built on.
 *
 * Three layers, deliberately (see Reference/PRDs/REPORTS_PRD.md §9.1.2):
 *
 *   SOURCE  (does I/O)   one parameterized query. Deduped across every widget on
 *                        the board, so eight widgets reading the same scorecard
 *                        cost ONE query.
 *   METRIC  (pure)       source rows -> the shape a widget draws. No I/O, so it
 *                        is free to run, trivially testable, and reusable by
 *                        several widgets.
 *   WIDGET  (client)      a registered component + a DECLARED config schema.
 *                        The settings panel is generated from that schema, which
 *                        is the difference between "some widgets" and a library.
 *
 * The middle layer is why widgets don't fetch for themselves: today the same
 * reshaping happens in a route AND again in a view (Board 8 computes its
 * best-retaining source twice), and that duplication is what this kills.
 */

/** A resolved date window. `start`/`end` are inclusive YYYY-MM-DD, business-local. */
export type WindowSpec = {
  start: string
  end: string
  /** Human label for card subtitles, e.g. "Jan 1 – Aug 10, 2026". */
  label: string
  /** Short phrase for sentences, e.g. "2026 YTD". */
  phrase: string
}

/** Every source the framework knows how to run. Add here + in ./sources.ts. */
export type SourceKey =
  | 'source_scorecard'
  | 'leads_decided'

export type SourceParams = Record<string, string | number | boolean | null>

export type SourceRequest = {
  source: SourceKey
  params: SourceParams
}

/** Stable dedupe key. Params are key-sorted so argument order can't split a cache slot. */
export function sourceKey(req: SourceRequest): string {
  const keys = Object.keys(req.params).sort()
  const parts = keys.map(k => `${k}=${String(req.params[k])}`)
  return `${req.source}|${parts.join('&')}`
}

/* ── Config schema — this is what generates the settings form ────────────── */

export type ConfigField =
  | { kind: 'number'; label: string; def: number; min: number; max: number; unit?: string; hint?: string }
  | { kind: 'enum'; label: string; def: string; opts: string[]; hint?: string }
  | { kind: 'multi'; label: string; def: string[]; opts: string[]; hint?: string }
  | { kind: 'bool'; label: string; def: boolean; hint?: string }

export type ConfigSchema = Record<string, ConfigField>
export type WidgetConfig = Record<string, unknown>

/** Fill unset keys from the schema so a metric never has to defend against undefined. */
export function withDefaults(schema: ConfigSchema, cfg: WidgetConfig | null | undefined): WidgetConfig {
  const out: WidgetConfig = {}
  for (const [k, f] of Object.entries(schema)) out[k] = f.def
  if (cfg) for (const [k, v] of Object.entries(cfg)) if (k in schema && v !== undefined && v !== null) out[k] = v
  return out
}

/** Reject anything the schema doesn't declare, and coerce what it does. */
export function sanitizeConfig(schema: ConfigSchema, raw: unknown): WidgetConfig {
  const out: WidgetConfig = {}
  const src = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  for (const [k, f] of Object.entries(schema)) {
    const v = src[k]
    if (v === undefined || v === null) { out[k] = f.def; continue }
    switch (f.kind) {
      case 'number': {
        const n = Number(v)
        out[k] = Number.isFinite(n) ? Math.min(f.max, Math.max(f.min, Math.round(n))) : f.def
        break
      }
      case 'enum':
        out[k] = f.opts.includes(String(v)) ? String(v) : f.def
        break
      case 'multi': {
        const arr = Array.isArray(v) ? v.map(String).filter(x => f.opts.includes(x)) : []
        out[k] = arr.length ? arr : f.def
        break
      }
      case 'bool':
        out[k] = v === true || v === 'true'
        break
    }
  }
  return out
}

/* ── Widget definition ──────────────────────────────────────────────────── */

/** Rows returned by the resolved sources, addressed by request. */
export type SourceBag = {
  get<T = unknown>(req: SourceRequest): T[]
}

export type WidgetDef<D = unknown> = {
  /** Stable id stored in the layout. Renaming one orphans saved boards. */
  type: string
  /** Groups the picker. */
  group: string
  title: string
  /** One line in the picker. */
  blurb: string
  defaultSpan: number
  config: ConfigSchema
  /** Declared so the resolver can batch. Must be a pure function of cfg + window. */
  sources: (cfg: WidgetConfig, win: WindowSpec) => SourceRequest[]
  /** Pure. Given the resolved rows, produce exactly what the component draws. */
  metric: (bag: SourceBag, cfg: WidgetConfig, win: WindowSpec) => D
  /** Set when the widget needs a source this tenant may not have connected. */
  requires?: string
}

/** One placed widget on a board. */
export type WidgetInstance = {
  id: string
  type: string
  span: number
  config: WidgetConfig
}

export type BoardLayout = {
  id: string
  slug: string
  title: string
  /** null = the company's shared board. */
  ownerUserId: string | null
  isPreset: boolean
  widgets: WidgetInstance[]
}

/** Sizes offered in the UI. Drag-resize allows any span 2..12; these are the stops. */
export const SPAN_STOPS: { label: string; span: number }[] = [
  { label: 'Quarter', span: 3 },
  { label: 'Third', span: 4 },
  { label: 'Half', span: 6 },
  { label: 'Full width', span: 12 },
]
export const MIN_SPAN = 2
export const MAX_SPAN = 12

export function clampSpan(n: unknown): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return 4
  return Math.min(MAX_SPAN, Math.max(MIN_SPAN, v))
}
