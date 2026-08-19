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
  | 'churn_summary'
  | 'invoice_window'
  | 'invoice_ar'
  | 'crew_labor'
  | 'communications'
  | 'clients_overview'
  | 'clients_geo'
  | 'service_lines'
  | 'sales_pipeline'
  | 'sales_person_trend'
  // Commission reads people UNNARROWED — see the resolver's note. Crew-gated only.
  | 'commission_people'
  // Two quote sources, not one: the cohort obeys the date picker, the open book is
  // point-in-time. See quotes.ts — the same split invoice_window/invoice_ar made.
  | 'quotes_cohort'
  | 'quotes_open'
  | 'home_pulse'
  | 'people'
  | 'goals'
  // Visit revenue bucketed over time. Takes `grain` (month|week) and
  // `tech_credit` as params, so the same source backs the monthly and weekly
  // views without a second query shape.
  | 'visit_revenue_trend'
  // Lead Tracker Service values × salesperson, for the tracked-item widgets.
  // Deliberately NOT parameterised by which items are selected: every tracked-item
  // card on a board sharing a basis and stage set then shares ONE query, however
  // many products are being counted.
  | 'lead_items'
  // The active recurring book, one row per (job, base-program line). Backs every
  // "how many customers / what is the book worth / what is the program mix / what
  // share bought the add-on" card — the questions the WF, IR and PW boards all open
  // with. Deliberately takes NO line or program parameter: filtering happens in the
  // metric, so a WF card and a PW card on one board still cost ONE query.
  | 'recurring_book'
  // Average and median value of a single completed job, per service line. The IR
  // repair-ticket card generalised.
  | 'ticket_size'
  // The bonus rules themselves — one row per (person, rule). A tiny table read, kept
  // as its own source so the commission cards stay pure metrics over existing data
  // rather than needing a function of their own.
  | 'commission_plans'

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

/** Runtime option lists a `catalog` field can be filled from. Served per company by
 *  app/api/hub/scoreboards/catalogs — see that route for what each one reads. */
export type CatalogName =
  | 'lead_services'
  | 'tracker_stages'
  /** Names credited on Lead Tracker cards — Sales, Tracked Items. */
  | 'lead_salespeople'
  /** Employee-roster names — Crew & Labor, People Performance. */
  | 'staff_people'
  /** Jobber user names — visit revenue by technician, quote reps. */
  | 'jobber_people'
  /**
   * The people who actually hold a commission rule, named exactly as the commission
   * cards name them. ⚠ A FOURTH catalog rather than reusing `staff_people`: that one
   * composes "Angel Morin" (Crew style) while the commission cards compose "Angel"
   * (People style), so a picker built on it would offer names matching nothing and
   * render an honest-looking zero. Derived from the same source the card draws from.
   */
  | 'commission_plan_people'
  /**
   * Service lines the tenant actually runs (WF / IR / PW / MO for Heroes), from
   * `recurring_program_definitions.dept_prefix`. Used by the book, ticket-size and
   * revenue-trend widgets.
   */
  | 'service_lines'
  /**
   * Recurring program names as the book reports them (`display_name`) — "IR Gold",
   * "Lawn Health Basic". Lets a card be about one program rather than a whole line,
   * which is how "Active IR Gold Customers" is expressed.
   */
  | 'recurring_programs'
  /** Add-ons — programs flagged `is_auxiliary`. Drives the attach-rate card. */
  | 'recurring_addons'
  /**
   * The people who actually hold a target, for narrowing a Goals card to one person.
   *
   * ⚠⚠ A FIFTH catalog, and the only one whose VALUES are employee ids rather than
   * names. Every other picker has to match on a name because that is all its chart
   * carries; a goal row carries `employee_id`, so this one can key on the roster row
   * the target is actually stored against. That makes it immune to a rename — the
   * failure the name-based pickers accept knowingly (see people-filter.ts) — and it
   * means two people who compose to the same name cannot merge. The name is only ever
   * the label.
   *
   * ⚠ Bounded to people who hold a target, like `commission_plan_people`: a picker
   * offering forty staff for a feature three of them have targets under is a worse
   * tool than one offering three.
   */
  | 'goal_people'

export type ConfigField =
  | { kind: 'number'; label: string; def: number; min: number; max: number; unit?: string; hint?: string }
  | { kind: 'enum'; label: string; def: string; opts: string[]; hint?: string }
  | { kind: 'multi'; label: string; def: string[]; opts: string[]; hint?: string }
  | { kind: 'bool'; label: string; def: boolean; hint?: string }
  | { kind: 'text'; label: string; def: string; placeholder?: string; hint?: string }
  /**
   * Multi-select whose options are the TENANT'S OWN DATA, fetched at render time.
   *
   * ⚠⚠ Why this can't be a `multi`. `multi` carries a static `opts` array declared
   * at import, and `sanitizeConfig` drops any value not in it. Heroes has 224
   * distinct invoiced line-item names and ~40 Lead Tracker Service values, they
   * differ per tenant, and new ones appear whenever somebody types one — so a
   * static list would be wrong on day one and would SILENTLY discard every
   * selection made against it. It also renders as a pill per option, which is fine
   * for four and unusable for forty.
   *
   * The consequence, stated plainly: values here cannot be validated against a
   * whitelist, so sanitizing bounds them (count, length) instead of verifying
   * them. That is safe because a value is only ever used as a string to match
   * against rows already scoped to the caller's company — never interpolated into
   * SQL, and never used to widen what is read.
   */
  | { kind: 'catalog'; label: string; def: string[]; catalog: CatalogName; hint?: string; max?: number }

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
      case 'text':
        out[k] = String(v).slice(0, 120)
        break
      case 'catalog': {
        // Bounded, not whitelisted — see the note on the field type. Empty stays
        // empty rather than falling back to the default: a tracked-item card with
        // nothing selected must say "pick your items", not quietly count something
        // the person didn't choose.
        const seen = new Set<string>()
        const arr = (Array.isArray(v) ? v : [])
          .map(x => String(x).trim())
          .filter(x => x.length > 0 && x.length <= 200)
          .filter(x => (seen.has(x) ? false : (seen.add(x), true)))
          .slice(0, f.max ?? 60)
        out[k] = arr
        break
      }
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
  /**
   * This viewer isn't entitled to the report this widget reads (custom boards
   * only — see ./gating.ts). It stays IN the list rather than being stripped out,
   * and that is load-bearing rather than cosmetic: the editor saves the widget
   * list wholesale, so silently dropping a card here would delete it from the
   * board the moment its own author saved a move — data loss triggered by a
   * permission change. Present-but-locked round-trips safely.
   */
  restricted?: boolean
}

export type BoardLayout = {
  id: string
  slug: string
  title: string
  /** null = the company's shared board. */
  ownerUserId: string | null
  isPreset: boolean
  /** Who built it. null on every preset — nobody built those. */
  createdBy?: string | null
  /** Custom board shared with everyone who can open Scoreboards. */
  sharedAll?: boolean
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

/**
 * How many cards one board may hold.
 *
 * ⚠ Lives here rather than in ./layouts.ts because BOTH ends need it: the save
 * silently truncates past this (a board nobody can read is not a feature), so the
 * editor has to stop you before you get there. Duplicating a card makes that easy
 * to hit by accident, and "I added cards and they vanished when I saved" is the
 * exact failure a client-side guard exists to prevent — but only while the two
 * numbers agree, hence one constant.
 */
export const MAX_WIDGETS_PER_BOARD = 60

/**
 * Insert a copy of the widget at `index`, immediately after it.
 *
 * Pure and exported so the copying rule can be tested — the part that matters is
 * invisible on screen until it goes wrong: the copy's config must be a DEEP copy.
 * Config values are arrays as often as scalars (ticked service lines, chosen
 * people), and a shallow copy hands both cards the same array — so narrowing the
 * duplicate to irrigation would silently narrow the original too, which is the
 * exact thing someone duplicates a card in order to avoid.
 *
 * `restricted` is deliberately not carried over: it isn't a property OF the card,
 * it's this viewer's verdict on it, recomputed server-side on the next load.
 */
export function duplicateWidgetAt(
  list: WidgetInstance[],
  index: number,
  newId: string,
): WidgetInstance[] {
  const src = list[index]
  if (!src) return list
  const copy: WidgetInstance = {
    id: newId,
    type: src.type,
    span: src.span,
    // JSON round-trip: a config is precisely what gets stored as jsonb, so there
    // is nothing in it (no dates, no functions, no undefined) a stringify loses.
    config: JSON.parse(JSON.stringify(src.config ?? {})) as WidgetConfig,
  }
  const next = [...list]
  next.splice(index + 1, 0, copy)
  return next
}

export function clampSpan(n: unknown): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return 4
  return Math.min(MAX_SPAN, Math.max(MIN_SPAN, v))
}
