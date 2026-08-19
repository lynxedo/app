/* The recurring book, sliced — and what one job is worth.
 *
 * These are the cards the WF, IR and PW boards all open with, in different clothes:
 * how many customers, what is the book worth, what is the average, what share bought
 * the add-on, how does the program mix look. Each of the four book widgets takes the
 * service line (or the program) as a SETTING, so one widget builds all three of those
 * boards — and gives Mosquito, which never had a board, the same cards for free.
 *
 * ⚠⚠ THE SOURCE TAKES NO DATE WINDOW, and that is deliberate rather than an
 * oversight. The recurring book is point-in-time: "how many active WF customers" in a
 * window that ended in March is not a smaller version of today's number, it is a
 * question the data cannot answer (nothing records what the book looked like on a
 * past date — the same reason `invoice_ar` is dateless). So every card here says "as
 * things stand today" on its face rather than quietly ignoring the date picker above
 * it. It also means every book card on one board shares ONE query.
 *
 * ⚠⚠ ADD-ONS AND PROGRAMS ARE TENANT DATA, NOT CODE. The old hardcoded WF board
 * carried two fixed booleans (`has_phc`, `has_bwp`) matching two exact Heroes line
 * item names, and ran program names through a substring parser that bucketed them
 * into Basic / Complete / Plus / Recovery / Other. Both are replaced here by reading
 * what the admin already maintains in `recurring_program_definitions`:
 * `is_auxiliary` marks an add-on, and `display_name` IS the program's human label.
 * The parser was also lossy on the real book — "Lawn Health Monthly" fell into
 * "Other", and Root Rot Recovery, the single biggest WF program at 75 of 137 jobs,
 * was relabelled "Recovery".
 */

import type { RecurringBookRow, TicketSizeRow } from './sources'
import type { SourceBag, SourceRequest, WidgetConfig, WidgetDef, WindowSpec } from './types'
import type { Tone, WidgetPayload } from './payloads'
import { formatCurrency } from '@/lib/format'

const asArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : []

/** A comma-separated text field, as a clean list. */
const asList = (v: unknown): string[] =>
  String(v ?? '').split(',').map(s => s.trim()).filter(Boolean)

const num = (v: number | string | null | undefined): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Case- and whitespace-insensitive match key, so a picker entry ticked with odd
 *  spacing still lines up with the row it came from. Never folds words. */
const key = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

const UNASSIGNED_LINE = 'No line'
const UNNAMED_PROGRAM = 'Unnamed program'

const lineOf = (r: RecurringBookRow) => r.dept_prefix?.trim() || UNASSIGNED_LINE
const programOf = (r: RecurringBookRow) => r.display_name?.trim() || UNNAMED_PROGRAM


/* ── shared plumbing ─────────────────────────────────────────────────────── */

const bookReq = (): SourceRequest => ({ source: 'recurring_book', params: {} })

function book(bag: SourceBag): RecurringBookRow[] {
  return bag.get<RecurringBookRow>(bookReq())
}

const LINES_FIELD = {
  kind: 'catalog' as const,
  label: 'Which service lines',
  def: [] as string[],
  catalog: 'service_lines' as const,
  hint: 'Leave every box unticked for the whole company.',
}

const PROGRAMS_FIELD = {
  kind: 'catalog' as const,
  label: 'Narrow to these programs',
  def: [] as string[],
  catalog: 'recurring_programs' as const,
  hint: 'Optional. Tick “IR Gold” to make this card about Gold customers rather than all of irrigation.',
}

type Filter = { lines: Set<string>; programs: Set<string> }

function filterOf(cfg: WidgetConfig): Filter {
  return {
    lines: new Set(asArray(cfg.lines).map(key)),
    programs: new Set(asArray(cfg.programs).map(key)),
  }
}

/**
 * ⚠ An empty selection means EVERYTHING, never nothing. This is the same rule the
 * person filter follows and the reason it is safe: a filter can only ever remove rows
 * the card was already entitled to, and "I ticked nothing" must not render an honest-
 * looking zero.
 */
function keep(f: Filter, r: RecurringBookRow): boolean {
  if (f.lines.size && !f.lines.has(key(lineOf(r)))) return false
  if (f.programs.size && !f.programs.has(key(programOf(r)))) return false
  return true
}

function rows(bag: SourceBag, cfg: WidgetConfig): RecurringBookRow[] {
  const f = filterOf(cfg)
  return book(bag).filter(r => keep(f, r))
}

/** What this card is about, in words — a tile reading "137" must say 137 of what. */
function scopePhrase(cfg: WidgetConfig): string {
  const lines = asArray(cfg.lines)
  const programs = asArray(cfg.programs)
  if (programs.length) return programs.join(' + ')
  if (lines.length) return lines.join(' + ')
  return 'every service line'
}

/**
 * The unpriced warning.
 *
 * ⚠⚠ Annual value is visits-per-year × line-item total, so a base program with no
 * visits-per-year set computes to 0. That is a blank admin field, not a business
 * fact, and it is live: all ten Heroes Mosquito jobs are in exactly that state, so a
 * plain "book value by line" chart prints Mosquito $0 next to WF's $230k and reads as
 * a dead service line. Stated in words instead.
 */
function unpricedNote(set: RecurringBookRow[]): string | null {
  const bad = set.filter(r => !r.is_priced)
  if (!bad.length) return null
  const lines = [...new Set(bad.map(lineOf))].sort()
  const n = bad.length
  return `${n} job${n === 1 ? '' : 's'} (${lines.join(', ')}) count toward the total but add $0, `
    + `because their program has no visits-per-year set in Service Mapping — a blank field, not free work`
}

const AS_OF = 'as things stand today, whatever date range is set above'


/* ── the widgets ─────────────────────────────────────────────────────────── */

const MIX_TONES: Tone[] = ['good', 'warn', 'mixed', 'neutral', 'paid', 'free', 'bad', 'unknown']

const COUNT_JOBS = 'Jobs'
const COUNT_CUSTOMERS = 'Customers'

const VALUE_TOTAL = 'Total for the book'
const VALUE_AVERAGE = 'Average per job'

const MIX_BY_COUNT = 'How many jobs'
const MIX_BY_VALUE = 'Annual value'

const MATCH_ANY = 'Any one of them'
const MATCH_ALL = 'All of them'

export const BOOK_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'kpi_book_by_line',
    // Same group as the company-wide `kpi_recurring_book` it slices, so it answers to
    // the Clients grant. Deliberately NOT Service Lines: that report is payroll-shaped
    // and gated for that reason, and a customer count carries no wage data.
    group: 'Clients',
    title: 'Book Size',
    blurb: 'Active recurring jobs or customers, for one service line or program',
    defaultSpan: 3,
    config: {
      lines: LINES_FIELD,
      programs: PROGRAMS_FIELD,
      count: {
        kind: 'enum' as const,
        label: 'Count',
        def: COUNT_JOBS,
        opts: [COUNT_JOBS, COUNT_CUSTOMERS],
        hint: 'One customer can hold jobs on several lines, so these are genuinely different numbers.',
      },
      label: {
        kind: 'text' as const,
        label: 'Name on the card',
        def: '',
        placeholder: 'e.g. Active IR Gold Customers',
        hint: 'Leave blank and the card names the filter itself.',
      },
    },
    sources: () => [bookReq()],
    metric: (bag, cfg): WidgetPayload => {
      const set = rows(bag, cfg)
      const customers = String(cfg.count) === COUNT_CUSTOMERS
      /* ⚠ Jobs and customers are different figures and the card must not blur them:
       * Heroes' 309 book rows belong to fewer people, because one customer can hold a
       * WF job and an IR job. The tile says which it counted. */
      const value = customers
        ? new Set(set.map(r => r.client_id)).size
        : set.length
      const scope = scopePhrase(cfg)
      // No unpriced note on a COUNT card: a missing visits-per-year affects value, not
      // whether the job is on the books. Saying it here would be noise.
      return {
        kind: 'kpi',
        label: String(cfg.label).trim() || `Active ${customers ? 'Customers' : 'Jobs'} — ${scope}`,
        value: value.toLocaleString('en-US'),
        tone: 'good',
        sub: `${customers ? 'Distinct customers' : 'Recurring jobs'} on ${scope} · ${AS_OF}`,
      }
    },
  },

  {
    type: 'kpi_book_value',
    group: 'Clients',
    title: 'Book Value',
    blurb: 'What a service line or program is worth a year, in total or per job',
    defaultSpan: 3,
    config: {
      lines: LINES_FIELD,
      programs: PROGRAMS_FIELD,
      measure: {
        kind: 'enum' as const,
        label: 'Show',
        def: VALUE_TOTAL,
        opts: [VALUE_TOTAL, VALUE_AVERAGE],
      },
      label: {
        kind: 'text' as const,
        label: 'Name on the card',
        def: '',
        placeholder: 'e.g. Gold Annual Value',
        hint: 'Leave blank and the card names the filter itself.',
      },
    },
    sources: () => [bookReq()],
    metric: (bag, cfg): WidgetPayload => {
      const set = rows(bag, cfg)
      const average = String(cfg.measure) === VALUE_AVERAGE
      const total = set.reduce((s, r) => s + num(r.annual_value), 0)
      /* ⚠ The average divides by PRICED jobs only. Dividing by every job would drag
       * the figure down by however many programs are missing a visits-per-year, which
       * reads as "our customers pay less" rather than "a field is blank". */
      const priced = set.filter(r => r.is_priced)
      const value = average ? (priced.length ? total / priced.length : 0) : total
      const scope = scopePhrase(cfg)
      const unpriced = unpricedNote(set)
      return {
        kind: 'kpi',
        label: String(cfg.label).trim() || `${average ? 'Average Job Value' : 'Annual Value'} — ${scope}`,
        value: formatCurrency(value),
        tone: 'good',
        sub: [
          average
            ? `${formatCurrency(total)} across ${priced.length} priced job${priced.length === 1 ? '' : 's'} on ${scope}`
            : `Annual value of the active book on ${scope}`,
          AS_OF,
          ...(unpriced ? [unpriced] : []),
        ].join(' · '),
      }
    },
  },

  {
    type: 'book_by_program',
    group: 'Clients',
    title: 'Program Mix',
    blurb: 'How the recurring book splits across programs',
    defaultSpan: 6,
    config: {
      lines: LINES_FIELD,
      measure: {
        kind: 'enum' as const,
        label: 'Measure by',
        def: MIX_BY_COUNT,
        opts: [MIX_BY_COUNT, MIX_BY_VALUE],
      },
      chart: {
        kind: 'enum' as const,
        label: 'Draw as',
        def: 'Donut',
        opts: ['Donut', 'Bars'],
      },
    },
    sources: () => [bookReq()],
    metric: (bag, cfg): WidgetPayload => {
      const set = rows(bag, cfg)
      const byValue = String(cfg.measure) === MIX_BY_VALUE
      /* ⚠ Grouped on the program's own `display_name`, never a substring parser. Two
       * definitions CAN carry one program's name — the live table holds a row called
       * "Special Reduced Plan (typo variant)" for a missing-space spelling — so
       * identical labels fold here rather than splitting the chart in two. */
      const groups = new Map<string, { label: string; n: number; value: number }>()
      for (const r of set) {
        const label = programOf(r)
        const k = key(label)
        const g = groups.get(k) ?? { label, n: 0, value: 0 }
        g.n += 1
        g.value += num(r.annual_value)
        groups.set(k, g)
      }
      const parts = [...groups.values()]
        .map(g => ({ label: g.label, value: byValue ? g.value : g.n }))
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
      const scope = scopePhrase(cfg)
      const totalN = set.length
      const unpriced = unpricedNote(set)
      const note = [
        `${totalN} active recurring job${totalN === 1 ? '' : 's'}`,
        ...(byValue && unpriced ? [unpriced] : []),
      ].join(' · ')

      if (String(cfg.chart) === 'Bars') {
        return {
          kind: 'bars',
          title: `Program Mix — ${scope}`,
          sub: `${byValue ? 'Annual value' : 'Jobs'} per program · ${AS_OF}`,
          format: byValue ? 'currency' : 'number',
          rows: parts.map((p, i) => ({ label: p.label, value: p.value, tone: MIX_TONES[i % MIX_TONES.length] })),
          empty: `No active recurring jobs on ${scope}`,
        }
      }
      return {
        kind: 'donut',
        title: `Program Mix — ${scope}`,
        sub: `${byValue ? 'Annual value' : 'Jobs'} per program · ${AS_OF}`,
        // Same rule as the Bars branch above: annual value is money, a job count
        // is a count. Without this the legend printed raw dollars.
        format: byValue ? 'currency' : 'number',
        parts: parts.map((p, i) => ({ label: p.label, value: p.value, tone: MIX_TONES[i % MIX_TONES.length] })),
        note,
        empty: `No active recurring jobs on ${scope}`,
      }
    },
  },

  {
    type: 'addon_attach_rate',
    group: 'Clients',
    title: 'Add-On Attach Rate',
    blurb: 'What share of a line’s customers also buy an add-on',
    defaultSpan: 3,
    config: {
      lines: LINES_FIELD,
      addons: {
        kind: 'catalog' as const,
        label: 'Which add-ons',
        def: [] as string[],
        catalog: 'recurring_addons' as const,
        hint: 'The programs marked as add-ons in Service Mapping, with how many jobs carry each.',
      },
      match: {
        kind: 'enum' as const,
        label: 'Count a job when it has',
        def: MATCH_ANY,
        opts: [MATCH_ANY, MATCH_ALL],
        hint: '“Any one of them” answers “how many jobs have an add-on at all”.',
      },
      label: {
        kind: 'text' as const,
        label: 'Name on the card',
        def: '',
        placeholder: 'e.g. Plant Health Care',
      },
    },
    sources: () => [bookReq()],
    metric: (bag, cfg): WidgetPayload => {
      const set = rows(bag, cfg)
      const wanted = asArray(cfg.addons).map(key)
      const all = String(cfg.match) === MATCH_ALL
      const scope = scopePhrase(cfg)

      /* ⚠ Nothing ticked is NOT "every job matches" here, unlike the line filter —
       * an attach rate with no add-on chosen has no meaning, so the card asks rather
       * than printing 100%. */
      if (!wanted.length) {
        return {
          kind: 'kpi',
          label: String(cfg.label).trim() || 'Add-On Attach Rate',
          value: '—',
          tone: 'neutral',
          sub: 'Pick at least one add-on in this card’s settings. Add-ons are the programs marked as add-ons in Service Mapping.',
        }
      }

      const has = (r: RecurringBookRow) => {
        const names = new Set((r.addon_names ?? []).map(key))
        return all ? wanted.every(w => names.has(w)) : wanted.some(w => names.has(w))
      }
      const denom = set.length
      const hit = set.filter(has).length
      const pct = denom > 0 ? Math.round((hit / denom) * 1000) / 10 : 0
      const name = asArray(cfg.addons).join(all ? ' + ' : ' or ')
      return {
        kind: 'kpi',
        label: String(cfg.label).trim() || name,
        value: denom > 0 ? `${pct}%` : '—',
        /* ⚠ Monotonic, which it was NOT. The band used to be
         *   pct >= 25 ? 'good' : pct >= 10 ? 'warn' : 'neutral'
         * so a 5% attach rate rendered CALMER than a 14.9% one — worse news in a
         * quieter colour, which is the one thing a tone must never do. The 10%
         * boundary is gone rather than moved; nobody chose it either. 25% stays only
         * because it is what the card has always shown, and it is the admin's to
         * change — ⚠ note that a target is NOT currently the answer for this one, as
         * the recurring book takes no dates and so cannot be a goal metric. */
        tone: pct >= 25 ? 'good' : 'warn',
        sub: denom > 0
          ? `${hit} of ${denom} recurring job${denom === 1 ? '' : 's'} on ${scope} · ${AS_OF}`
          : `No active recurring jobs on ${scope}`,
      }
    },
  },
]


/* ── ticket size ─────────────────────────────────────────────────────────── */

const TICKET_MEDIAN = 'Median (typical job)'
const TICKET_AVERAGE = 'Average'

export const TICKET_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'kpi_ticket_size',
    /**
     * Revenue, not Service Lines. This measures money per completed job and involves
     * no labour cost at all, so requiring the payroll-shaped Service Lines grant
     * would withhold it for the wrong reason.
     */
    group: 'Revenue',
    title: 'Ticket Size',
    blurb: 'What one completed job is worth — the repair-ticket measure, for any line',
    defaultSpan: 3,
    config: {
      lines: {
        ...LINES_FIELD,
        hint: 'Leave every box unticked for the whole company. Tick one line to answer “what does a typical irrigation repair bill”.',
      },
      /**
       * ⚠ Free text, not a pick-list, and that is the right shape rather than a
       * shortcut: these are matched as FRAGMENTS anywhere in a line-item name, so one
       * entry ("Installation") stands in for a dozen exact names and keeps working
       * when a new one is added. A pick-list would have to be re-ticked every time
       * somebody invents a line item.
       *
       * No default, because a default here would be Heroes' three exclusions baked
       * into the library. The hint carries them as an example instead.
       */
      exclude: {
        kind: 'text' as const,
        label: 'Leave these out',
        def: '',
        placeholder: 'Service Plan, Installation, Drainage',
        hint: 'Comma-separated, matched anywhere in the line-item name. What you exclude IS the measure: leaving out service plans, installs and drainage is what turns “a job” into “a repair”.',
      },
      measure: {
        kind: 'enum' as const,
        label: 'Show',
        def: TICKET_MEDIAN,
        opts: [TICKET_MEDIAN, TICKET_AVERAGE],
        hint: 'Median is the typical job. One large install drags an average a long way.',
      },
      label: {
        kind: 'text' as const,
        label: 'Name on the card',
        def: '',
        placeholder: 'e.g. Avg Repair Ticket',
      },
    },
    sources: (cfg, win) => [ticketReq(cfg, win)],
    metric: (bag, cfg, win): WidgetPayload => {
      const row = bag.get<TicketSizeRow>(ticketReq(cfg, win))[0] ?? null
      const median = String(cfg.measure) === TICKET_MEDIAN
      const value = median ? num(row?.median_value) : num(row?.avg_value)
      const n = num(row?.ticket_count)
      const scope = scopePhrase(cfg)
      const other = median ? num(row?.avg_value) : num(row?.median_value)
      const excluded = asList(cfg.exclude)
      return {
        kind: 'kpi',
        label: String(cfg.label).trim() || `${median ? 'Typical' : 'Average'} Ticket — ${scope}`,
        value: n > 0 ? formatCurrency(value) : '—',
        tone: 'good',
        sub: n > 0
          ? [
              `${n.toLocaleString('en-US')} completed job${n === 1 ? '' : 's'} on ${scope} in ${win.phrase}`,
              `${median ? 'average' : 'median'} ${formatCurrency(other)}`,
              `${formatCurrency(num(row?.total_value))} in total`,
              ...(excluded.length ? [`leaving out ${excluded.join(', ')}`] : []),
            ].join(' · ')
          : `No completed jobs on ${scope} in ${win.phrase}`,
      }
    },
  },
]

function ticketReq(cfg: WidgetConfig, win: WindowSpec): SourceRequest {
  // Sorted so two cards ticking the same things in a different order share one query.
  const lines = [...asArray(cfg.lines)].sort().join(',')
  const exclude = [...asList(cfg.exclude)].sort().join(',')
  return { source: 'ticket_size', params: { start: win.start, end: win.end, lines, exclude } }
}
