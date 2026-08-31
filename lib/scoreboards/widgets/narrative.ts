/* "What the Numbers Say" for a whole board — the card that reads the cards.
 *
 * Ben's ask, verbatim: "I really love the idea of each user and each department
 * having a 'what the numbers say' that is relevant only for the widgets on that
 * custom board. Is that possible? How well they are performing against goals /
 * Areas of opportunity / Wins/Loss." Those three are the three sections.
 *
 * REPORTS_PRD.md §9.2 specced this from a hand dry-run against a real 18-card
 * board, and two things in it decided the shape of this file.
 *
 * ⚠⚠ THE EDITORIAL RULE, and the reason this is worth reading twice: it reports
 * JUDGEMENTS, CHANGES and COMPARISONS — never values. A tile already shows its own
 * number; a narrator that restated all twelve of them would be a second, worse copy
 * of the board, and nobody would read it a second time. So a card with nothing
 * judged and nothing moving contributes NOTHING here, and is still counted as read.
 * What earns a sentence is arithmetic the reader would otherwise do themselves:
 * a target compared to its actual, a period compared to the one before it, a slice
 * measured against its whole, several cards summarised at once.
 *
 * ⚠⚠ THE SAFETY RULE: every figure quoted is either a string a widget already
 * formatted, or a raw number run through `formatPayloadValue` with that payload's
 * own declared format. The narrator never invents units and never re-rounds. This is
 * why the donut and stacked payloads had to gain a `format` field before this card
 * could speak about them at all — without it a dollar slice was a bare number, which
 * is exactly the defect §9.2.7 recorded and Ben spotted on his own board.
 *
 * ⚠ Templated strings, not a model. Same rule as the nine domain insight cards it
 * sits beside (checked: there is no NLG anywhere in the widget library). The trade is
 * that coverage grows one payload kind at a time — so the card SAYS what it did not
 * read rather than implying it read everything.
 *
 * ⚠ Adds no queries and cannot widen access: see the `narrate` note in ./types.ts.
 */

import { getGoalMetric } from '@/lib/reports/goals'
import {
  GOAL_SCOPE_CONFIG, goalRequest, scopedGoals,
  goalStatusText, goalStatusTone, formatGoalValue, formatGoalTarget, goalOwner,
  goalMoneyDecimals,
  goalScopePhrase, goalsEmptyBecause, goalPeriodCell,
} from './goals'
import type { GoalRow, RevenueTrendRow } from './sources'
import { formatPayloadValue } from './payloads'
import type {
  AttentionPayload, BarsPayload, DonutPayload, KpiPayload, NarrativePayload,
  StackedPayload, TablePayload, Tone, ValueFormat, WidgetPayload,
} from './payloads'
import type {
  NarrativeInput, NarrativeSibling, SourceBag, SourceRequest, WidgetConfig, WidgetDef, WindowSpec,
} from './types'

type Line = { text: string; tone?: Tone }

/** How many points any one section may print, before the config narrows it. */
const HARD_LINE_CAP = 8

/* ── small pure helpers ─────────────────────────────────────────────────── */

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

/** Noon-UTC parse, so a YYYY-MM-DD never slips a day on either side of the date line. */
function at(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`)
}

function shortDate(iso: string): string {
  return at(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function pct(part: number, whole: number): number | null {
  if (!Number.isFinite(whole) || whole <= 0) return null
  return Math.round((part / whole) * 1000) / 10
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many
}

/** "a, b and c", capped, with "and N more" when it runs long. */
function nameSome(items: string[], cap: number): string {
  const shown = items.slice(0, cap)
  const rest = items.length - shown.length
  const joined = shown.length <= 1
    ? (shown[0] ?? '')
    : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
  return rest > 0 ? `${joined}, and ${rest} more` : joined
}

/** The payload a card drew, when it is one we recognise. */
function payloadOf(s: NarrativeSibling): WidgetPayload | null {
  const p = s.payload
  if (!p || typeof p !== 'object') return null
  const kind = (p as { kind?: unknown }).kind
  return typeof kind === 'string' ? (p as WidgetPayload) : null
}

/* ── which period a card covers ─────────────────────────────────────────────
 *
 * Read off the card's own source requests rather than a list of widget types, so a
 * widget added next year is classified correctly without touching this file.
 *
 * A card with no `start` on any request is POINT-IN-TIME: the recurring book takes no
 * dates at all, because it is what is on the books right now. §9.2.6 found eight such
 * cards on an eighteen-card board, and folding them into a sentence about July would
 * be plainly false — their own subtitles say "as things stand today", and this card
 * has to inherit that rather than paper over it.
 */
type CardPeriod =
  | { kind: 'asOfToday' }
  | { kind: 'window'; start: string; end: string; grain: string | null }
  | { kind: 'none' }

function cardPeriod(s: NarrativeSibling): CardPeriod {
  if (s.requests.length === 0) return { kind: 'none' }
  const dated = s.requests
    .map(r => ({ start: r.params.start, end: r.params.end }))
    .filter(x => typeof x.start === 'string' && typeof x.end === 'string') as { start: string; end: string }[]
  if (dated.length === 0) return { kind: 'asOfToday' }
  // Widest span the card reads, so a card with two requests is described by what it
  // actually covers rather than by whichever request happened to be first.
  const start = dated.map(d => d.start).sort()[0]
  const end = dated.map(d => d.end).sort().slice(-1)[0]
  /* ⚠ Read, never inferred. A first draft guessed month-vs-week from the shape of the
   * first bar's label, which would have decided whether a bar was complete off a
   * display string — the request is where the grain is actually stated. */
  const grain = s.requests.map(r => r.params.grain).find(g => typeof g === 'string')
  return { kind: 'window', start, end, grain: typeof grain === 'string' ? grain : null }
}

/* ── how far a time-bucketed chart can be trusted at its right-hand edge ────
 *
 * ⚠⚠ The trap this exists for: the newest bar on a monthly chart is usually the
 * month we are standing in, so it is LOW because the month is not over. Reporting
 * that as a fall is the single most misleading thing a narrator could do, and it
 * would be wrong every month.
 *
 * `today` arrives as a parameter (see ./types.ts) so the boundaries are testable.
 */
function lastDayOfMonth(iso: string): boolean {
  const d = at(iso)
  const next = new Date(d.getTime())
  next.setUTCDate(next.getUTCDate() + 1)
  return next.getUTCMonth() !== d.getUTCMonth()
}

/** Postgres `date_trunc('week')` starts Monday, so a week bucket closes on Sunday. */
function isSunday(iso: string): boolean {
  return at(iso).getUTCDay() === 0
}

/**
 * How many bars at the right-hand end must not be compared.
 *
 * `null` = make no claim about change at all: the window runs into the future, so
 * more than one bar could be incomplete and there is no safe count.
 */
function untrustedTail(end: string, grain: string, today: string): number | null {
  if (end > today) return null
  const closes = grain === 'week' ? isSunday(end) : lastDayOfMonth(end)
  if (end === today) return 1
  return closes ? 0 : 1
}

/* ── the goals section ───────────────────────────────────────────────────────
 *
 * Reads the SAME rows the Goals cards read, through the same scope filter and the
 * same status words (imported from ./goals.ts, never reimplemented) — so this can
 * never say "behind" above a table that says "on track".
 *
 * ⚠ Only runs when a Goals card is actually on the board. `bag.has` is what makes
 * that knowable: an unrequested source returns an empty array exactly like one that
 * found nothing, and "no targets are set" is a very different statement from "this
 * board has no Goals card on it".
 */
const GOAL_ORDER: Record<GoalRow['status'], number> = {
  missed: 0, behind: 1, over: 2, under: 3, on_track: 4, hit: 5, pending: 6, open: 7, unknown: 8,
}

/**
 * Is this target short of its number?
 *
 * ⚠ Keyed on the STATUS alone, not on status-crossed-with-whether-the-period-is-over.
 * A first version asked for open-and-off-track OR closed-and-'missed', which silently
 * dropped a finished period sitting on 'over' or 'under' — the ceiling and rate
 * verdicts — so a labour-cost target that finished over budget would have been left
 * out of the one section that exists to name it. Four words mean short, whenever they
 * appear: caught by a test, not by reading.
 */
function isShort(status: GoalRow['status']): boolean {
  return status === 'missed' || status === 'behind' || status === 'over' || status === 'under'
}

function goalSentence(g: GoalRow): string {
  const label = getGoalMetric(g.metric)?.label ?? g.metric
  const who = g.employee_id ? goalOwner(g) : 'The company'
  // Same per-row precision the target cards use, so the sentence and the card
  // beneath it never print one target's money two different ways.
  const dp = goalMoneyDecimals(g)
  const actual = formatGoalValue(g.metric, g.actual, dp)
  const target = formatGoalTarget(g, dp)
  const share = g.attainment_pct == null ? '' : ` (${num(g.attainment_pct)}%)`
  const period = goalPeriodCell(g)
  if (g.actual == null) {
    return `${who} — ${label}, ${period}: target ${target}, but there is no figure to measure it against.`
  }
  return `${who} — ${label}, ${period}: ${actual} against ${target}${share} — ${goalStatusText[g.status].toLowerCase()}.`
}

/**
 * Collapse a repeating target's periods into one sentence.
 *
 * ⚠ Written after seeing the real output: a standing "$25,000 monthly" target that was
 * short in January, May and July printed as three near-identical sentences, which
 * crowded a genuinely different target (the company's own) off the card entirely. A
 * repeating target is ONE target judged many times, and reads better as one line — the
 * pattern across months is the useful part, not each month restated.
 *
 * Only rows from a repeating target are grouped; a one-off target set for a specific
 * period keeps its own sentence, because that number was chosen for that period.
 */
function groupedGoalLines(rows: GoalRow[], cap: number): Line[] {
  const out: Line[] = []
  const seen = new Set<string>()
  for (const g of rows) {
    if (out.length >= cap) break
    if (!g.repeating) { out.push({ text: goalSentence(g), tone: goalStatusTone[g.status] }); continue }
    const key = `${g.employee_id ?? 'company'}|${g.metric}|${g.grain}|${g.target}`
    if (seen.has(key)) continue
    seen.add(key)
    const family = rows.filter(x => x.repeating && `${x.employee_id ?? 'company'}|${x.metric}|${x.grain}|${x.target}` === key)
    if (family.length === 1) { out.push({ text: goalSentence(g), tone: goalStatusTone[g.status] }); continue }
    const who = g.employee_id ? goalOwner(g) : 'The company'
    const label = getGoalMetric(g.metric)?.label ?? g.metric
    const noun = g.grain === 'month' ? 'monthly' : g.grain === 'quarter' ? 'quarterly' : 'yearly'
    const periods = family.map(x => periodWord(x))
    const worst = family.reduce((a, b) => (num(a.attainment_pct) <= num(b.attainment_pct) ? a : b))
    out.push({
      text: `${who} — ${label}: the standing ${noun} target of ${formatGoalTarget(g, goalMoneyDecimals(g))} was short in ${nameSome(periods, 4)}, weakest at ${formatGoalValue(g.metric, worst.actual, goalMoneyDecimals(worst))} (${num(worst.attainment_pct)}%) in ${periodWord(worst)}.`,
      tone: goalStatusTone[worst.status],
    })
  }
  return out
}

/** Just the period, without the "· monthly target" suffix a grouped line already says. */
function periodWord(g: GoalRow): string {
  return goalPeriodCell(g).split(' · ')[0]
}

type GoalRead = {
  present: boolean
  lines: Line[]
  wins: Line[]
  watch: Line[]
  /** Set when the board has no Goals card, so the foot can offer the fix. */
  invite: boolean
}

function readGoals(input: NarrativeInput, cfg: WidgetConfig, win: WindowSpec, cap: number): GoalRead {
  const req = goalRequest(win)
  if (!input.bag.has(req)) {
    return { present: false, lines: [], wins: [], watch: [], invite: true }
  }

  // NarrativeBag satisfies SourceBag's shape; scopedGoals only ever reads `get`.
  const { r, goals, scope } = scopedGoals(input.bag as SourceBag, cfg, win)

  if (goals.length === 0) {
    return { present: true, lines: [{ text: goalsEmptyBecause(scope, r), tone: 'neutral' }], wins: [], watch: [], invite: false }
  }

  const open = goals.filter(g => !g.closed)
  const judgeable = open.filter(g => g.status !== 'pending' && g.status !== 'unknown')
  const good = judgeable.filter(g => g.status === 'hit' || g.status === 'on_track')
  /** Open, judgeable and not making it — drives the summary line's colour. */
  const off = judgeable.filter(g => isShort(g.status))
  const finished = goals.filter(g => g.closed && g.status !== 'unknown')
  const hitFinished = finished.filter(g => g.status === 'hit')
  const unmeasured = goals.filter(g => g.status === 'unknown')
  const waiting = open.filter(g => g.status === 'pending')

  const whoseWords = goalScopePhrase(scope, goals)
  const lines: Line[] = []

  lines.push({
    text: [
      `${goals.length} ${plural(goals.length, 'target')} ${plural(goals.length, 'overlaps', 'overlap')} ${win.phrase}`,
      whoseWords ? ` (${whoseWords})` : '',
      judgeable.length
        ? `: ${good.length} of ${judgeable.length} still open ${plural(judgeable.length, 'is', 'are')} on track or already hit`
        : ': none of the open ones can be judged yet',
      finished.length ? `, and ${hitFinished.length} of ${finished.length} finished ${plural(finished.length, 'period')} made the number` : '',
      '.',
    ].join(''),
    tone: judgeable.length === 0 ? 'neutral' : off.length === 0 ? 'good' : good.length === 0 ? 'bad' : 'warn',
  })

  /* ⚠⚠ PARTITIONED, not duplicated. A first version listed the worst targets here AND
   * repeated them verbatim under "Worth a look", which on a real board printed the same
   * sentence twice on one card and read as a bug. Targets that are being missed belong
   * to this section; the ones being HIT go to Wins, where a reader looking for good
   * news will find them; and nothing about targets is repeated in "Worth a look". */
  const missing = goals.filter(g => isShort(g.status))
    .sort((a, b) => GOAL_ORDER[a.status] - GOAL_ORDER[b.status])
  for (const line of groupedGoalLines(missing, cap - 1)) lines.push(line)
  const grouped = groupedGoalLines(missing, cap - 1).length
  if (grouped === cap - 1 && missing.length > grouped) {
    lines.push({ text: `More short targets than fit here — the Goals card lists them all.`, tone: 'neutral' })
  }
  if (missing.length === 0 && goals.length > 0) {
    lines.push({ text: 'No target is being missed.', tone: 'good' })
  }

  const wins: Line[] = []
  const watch: Line[] = []
  for (const g of [...good, ...hitFinished].slice(0, 3)) {
    wins.push({ text: goalSentence(g), tone: 'good' })
  }
  if (unmeasured.length) {
    watch.push({
      // A target nothing can measure is a settings problem, not a performance one,
      // and saying so is the difference between fixing it and ignoring it.
      text: `${unmeasured.length} ${plural(unmeasured.length, 'target')} ${plural(unmeasured.length, 'has', 'have')} no figure behind ${plural(unmeasured.length, 'it', 'them')} — either the period has no data or the measure is no longer available.`,
      tone: 'unknown',
    })
  }
  if (waiting.length) {
    lines.push({
      text: `${waiting.length} ${plural(waiting.length, 'target')} ${plural(waiting.length, 'is', 'are')} being measured but ${plural(waiting.length, 'gets', 'get')} no verdict until ${plural(waiting.length, 'its', 'their')} period ends.`,
      tone: 'neutral',
    })
  }

  return { present: true, lines, wins, watch, invite: false }
}

/* ── generic payload readers ────────────────────────────────────────────────
 *
 * ⚠ Cards in the Goals group are skipped here on purpose: the section above already
 * reads their rows from the source, and reading their payloads as well would report
 * every target twice in different words.
 */

/* ── naming a card the reader can actually find ──────────────────────────────
 *
 * ⚠ Ben's board holds the same chart twice on purpose — "Visit Revenue by Technician"
 * by month and by week, "Program Mix — WF" by jobs and by value — so a sentence saying
 * `On "Program Mix — WF"` leaves the reader unable to tell which of the two it means.
 *
 * The discriminator is only added when the title is genuinely repeated on this board:
 * appending "(by month)" to a chart that appears once is noise, and noise in a card
 * whose whole job is to be readable costs more than it looks.
 */
function titleCounts(siblings: NarrativeSibling[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const s of siblings) {
    const p = payloadOf(s)
    if (!p || !('title' in p) || !p.title) continue
    counts.set(p.title, (counts.get(p.title) ?? 0) + 1)
  }
  return counts
}

function cardName(title: string, counts: Map<string, number>, hint: string | null): string {
  if ((counts.get(title) ?? 0) < 2 || !hint) return title
  return `${title} (${hint})`
}

/**
 * A tile earns a sentence when the WIDGET has graded it — never because it is coloured.
 *
 * ⚠⚠ This read `p.tone` in its first version and was wrong on a real board: it
 * reported "Flagged on this board: Commission Owed $7,299" (amber because commission
 * is money owed) and "Reading well: WF Annual Value $284,288" (green because a book is
 * a good thing). Roughly a fifth of the KPI tiles in the library colour themselves for
 * looks. `judged` is the tile saying its colour is a verdict on its own value; without
 * it, this stays silent. See KpiPayload.judged.
 */
function judgedKpis(cards: { title: string; p: KpiPayload }[]): { wins: string[]; watch: string[]; moved: Line[] } {
  const wins: string[] = []
  const watch: string[] = []
  const moved: Line[] = []
  for (const { p } of cards) {
    const name = p.label || 'This figure'
    if (p.delta && p.delta.pct != null) {
      // A delta is a computed change by construction, and the widget also decided
      // whether comparing was honest at all — quote its words, don't recompute.
      moved.push({ text: `${name} is ${p.value} — ${p.delta.text}.`, tone: p.delta.tone })
      continue
    }
    if (!p.judged) continue
    if (p.tone === 'good') wins.push(`${name} ${p.value}`)
    else if (p.tone === 'bad' || p.tone === 'warn') watch.push(`${name} ${p.value}`)
  }
  return { wins, watch, moved }
}

/** One slice or bar carrying most of the total is a fact about risk, not a value. */
function concentration(title: string, rows: { label: string; value: number }[], format: ValueFormat | undefined): Line | null {
  if (rows.length < 3) return null
  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0)
  if (total <= 0) return null
  const top = [...rows].sort((a, b) => b.value - a.value)[0]
  const share = pct(top.value, total)
  if (share == null || share < 40) return null
  /* ⚠ 50, not 60. At 60 the one case the PRD held up as worth having — a single
   * programme carrying 58% of a service line's annual value — landed in the neutral
   * pile and was then cut by the per-section cap, so the card never said it. Half of
   * anything resting on one entry is a concentration worth reading. */
  return {
    text: `On "${title}", ${top.label} alone is ${share}% of the total (${formatPayloadValue(top.value, format)} of ${formatPayloadValue(total, format)}) across ${rows.length} ${plural(rows.length, 'entry', 'entries')}.`,
    tone: share >= 50 ? 'warn' : 'neutral',
  }
}

/**
 * Change between the two most recent TRUSTED bars, and where the peak sits.
 *
 * Both periods are named in the sentence, which is what makes the claim safe even if
 * a bucket in the middle is missing from the series: it is a statement about two
 * labelled bars, not about "last month".
 */
function trendLines(title: string, p: StackedPayload, period: CardPeriod, today: string): Line[] {
  const rows = p.rows
  if (rows.length < 2 || period.kind !== 'window') return []
  const grain = period.grain ?? 'month'
  const drop = untrustedTail(period.end, grain, today)
  const out: Line[] = []

  const totals = rows.map(r => r.parts.reduce((s, x) => s + Math.max(0, x.value), 0))
  const peakAt = totals.indexOf(Math.max(...totals))
  if (totals[peakAt] > 0 && rows.length >= 3) {
    out.push({ text: `On "${title}", the strongest period shown is ${rows[peakAt].label} at ${rows[peakAt].caption}.`, tone: 'neutral' })
  }

  if (drop === null) {
    out.push({ text: `"${title}" runs past today, so no change between periods is reported on it.`, tone: 'neutral' })
    return out
  }
  const iNow = rows.length - 1 - drop
  const iPrev = iNow - 1
  if (iPrev < 0) return out

  const now = totals[iNow], prev = totals[iPrev]
  if (prev <= 0) return out
  const change = Math.round(((now - prev) / prev) * 1000) / 10
  if (Math.abs(change) < 5) {
    out.push({ text: `On "${title}", ${rows[iNow].label} (${rows[iNow].caption}) held roughly level with ${rows[iPrev].label} (${rows[iPrev].caption}).`, tone: 'neutral' })
  } else {
    out.push({
      text: `On "${title}", ${rows[iNow].label} came in ${Math.abs(change)}% ${change < 0 ? 'below' : 'above'} ${rows[iPrev].label} (${rows[iNow].caption} against ${rows[iPrev].caption}).`,
      tone: change < 0 ? 'warn' : 'good',
    })
  }
  if (drop > 0) {
    // Say why the newest bar was left out, or the reader will wonder why the card
    // and the sentence disagree about which period is most recent.
    out.push({ text: `The newest bar on "${title}" (${rows[rows.length - 1].label}) covers a period still in progress, so it is left out of that comparison.`, tone: 'neutral' })
  }
  return out
}

/** Rows a table has itself flagged. */
function tableLine(title: string, p: TablePayload): Line | null {
  const flagged = p.rows.filter(r => Object.values(r.tones ?? {}).some(t => t === 'bad' || t === 'warn'))
  if (!p.rows.length || !flagged.length) return null
  return {
    text: `"${title}" flags ${flagged.length} of ${p.rows.length} ${plural(p.rows.length, 'row')}, starting with ${String(flagged[0].cells[p.columns[0].key] ?? 'the first')}.`,
    tone: flagged.some(r => Object.values(r.tones ?? {}).includes('bad')) ? 'bad' : 'warn',
  }
}

function attentionLines(p: AttentionPayload): Line[] {
  return p.chips
    .filter(c => (c.tone === 'bad' || c.tone === 'warn') && c.value !== '0' && c.value !== '—')
    .map(c => ({ text: `${c.label}: ${c.value}${c.detail ? ` — ${c.detail}` : ''}`, tone: c.tone }))
}

/* ── the one comparison no single card can make ─────────────────────────────
 *
 * §9.2.3's finding, and the reason the PRD called this feature justified: on a board
 * filtered to one service line, a person credited with MORE revenue than that whole
 * line produced did some of their work outside it. Reading the per-technician series
 * against the per-line series is the only way to see it, and no widget has ever been
 * handed a sibling's data.
 *
 * ⚠⚠ Both figures must come from ONE fetched row, so they cover the same period by
 * construction. Two cards set to different windows — a trailing-six-month chart
 * beside a year-to-date tile — are not comparable, and comparing them would
 * manufacture a discrepancy out of the date settings. When that is the case this
 * stays silent, and the foot's period note is what tells the reader why.
 *
 * ⚠ It reports "worth a look", never a decomposition: the source returns techs[] and
 * lines[] as separate arrays with no tech-by-line cross, so the overspill can be
 * detected and cannot be explained.
 */
function personVsLine(siblings: NarrativeSibling[], input: NarrativeInput): Line[] {
  const out: Line[] = []
  const trendCards = siblings.filter(s => s.requests.some(r => r.source === 'visit_revenue_trend'))
  if (trendCards.length < 2) return out

  const byKey = new Map<string, { req: SourceRequest; people: string[]; lines: string[] }>()
  for (const s of trendCards) {
    for (const req of s.requests) {
      if (req.source !== 'visit_revenue_trend') continue
      const key = `${req.params.start}|${req.params.end}|${req.params.grain}|${req.params.tech_credit}`
      const slot = byKey.get(key) ?? { req, people: [], lines: [] }
      const people = Array.isArray(s.config.people) ? s.config.people.map(String) : []
      const lines = Array.isArray(s.config.lines) ? s.config.lines.map(String) : []
      if (people.length) slot.people.push(...people)
      if (lines.length) slot.lines.push(...lines)
      byKey.set(key, slot)
    }
  }

  for (const slot of byKey.values()) {
    if (!slot.people.length || !slot.lines.length) continue
    const row = input.bag.get<RevenueTrendRow>(slot.req)[0]
    if (!row) continue
    const wantedPeople = new Set(slot.people.map(p => p.trim().toLowerCase()))
    const wantedLines = new Set(slot.lines.map(l => l.trim().toUpperCase()))
    const personTotal = (row.techs ?? [])
      .filter(t => wantedPeople.has(String(t.name ?? '').trim().toLowerCase()))
      .reduce((s, t) => s + num(t.total), 0)
    const lineTotal = (row.lines ?? [])
      .filter(l => wantedLines.has(String(l.k ?? '').trim().toUpperCase()))
      .reduce((s, l) => s + num(l.total), 0)
    if (personTotal <= 0 || lineTotal <= 0) continue
    if (personTotal <= lineTotal) continue
    const over = personTotal - lineTotal
    out.push({
      text: `${nameSome(slot.people, 2)} ${slot.people.length === 1 ? 'is' : 'are'} credited with ${formatPayloadValue(personTotal, 'currency')} between ${shortDate(String(slot.req.params.start))} and ${shortDate(String(slot.req.params.end))}, while the ${nameSome([...wantedLines], 3)} ${wantedLines.size === 1 ? 'line' : 'lines'} this board is filtered to produced ${formatPayloadValue(lineTotal, 'currency')} — ${formatPayloadValue(over, 'currency')} of that work sat outside ${wantedLines.size === 1 ? 'it' : 'them'}. Worth a look; the figures behind this cannot be split by person and line together, so this card cannot say which jobs.`,
      tone: 'warn',
    })
  }
  return out
}

/* ── the widget ─────────────────────────────────────────────────────────── */

const SKIPPED_KINDS = new Set(['list', 'geo', 'narrative'])

export const NARRATIVE_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'board_narrative',
    /**
     * ⚠⚠ Filed under Goals, and the group is the access decision: `canUseWidget`
     * turns a widget's group into the report grant needed to place it (./gating.ts).
     * Goals is the right one on three counts — it is the section Ben asked about
     * first, so it is the grant a personal scoreboard needs anyway; it is the least
     * sensitive report to hand out, unlike Revenue or Crew; and this card's own
     * reach does not depend on the choice, because a card the viewer isn't entitled
     * to is dropped before the resolver runs and its numbers never arrive here.
     *
     * ⚠ The trade, stated: somebody granted Sales but not Goals cannot place this on
     * their sales board. That is the fail-closed direction and one grant fixes it.
     */
    group: 'Goals',
    title: 'What the Numbers Say — This Board',
    blurb: 'Reads the other cards on this board: targets, wins, what to look at',
    defaultSpan: 12,
    config: {
      ...GOAL_SCOPE_CONFIG,
      points: {
        kind: 'number',
        label: 'Points per section',
        def: 4,
        min: 1,
        max: HARD_LINE_CAP,
        hint: 'Keep it low for a board on a wall, higher for one you read at a desk.',
      },
    },
    narrate: (input, cfg, win) => {
      const cap = Math.min(HARD_LINE_CAP, Math.max(1, num(cfg.points) || 4))
      const goals = readGoals(input, cfg, win, cap)

      const wins: Line[] = [...goals.wins]
      const watch: Line[] = [...goals.watch]
      const moved: Line[] = []

      /* Cards the narrator understood, cards it did not, and cards that broke — all
       * counted, because the foot has to be able to say so. */
      const kpis: { title: string; p: KpiPayload }[] = []
      let read = 0
      const unreadKinds = new Set<string>()
      let failed = 0

      const counts = titleCounts(input.siblings)
      for (const s of input.siblings) {
        const p = payloadOf(s)
        if (!p) { failed++; continue }
        // Targets are read from the source in the section above; reading these cards'
        // payloads as well would report every goal a second time in other words.
        if (s.group === 'Goals') { read++; continue }
        if (SKIPPED_KINDS.has(p.kind)) { unreadKinds.add(p.kind); continue }
        read++
        // A KPI's heading is `label`, everything else's is `title` — fall back to the
        // library title so a sentence never names a card the reader cannot find.
        const rawTitle = 'title' in p && p.title ? p.title : s.title
        const period = cardPeriod(s)
        switch (p.kind) {
          case 'kpi':
            kpis.push({ title: s.title, p })
            break
          case 'bars': {
            const fmt = (p as BarsPayload).format
            const c = concentration(cardName(rawTitle, counts, fmt === 'currency' ? 'by value' : 'by count'), p.rows, fmt)
            if (c) (c.tone === 'warn' ? watch : moved).push(c)
            break
          }
          case 'donut': {
            const fmt = (p as DonutPayload).format
            const c = concentration(cardName(rawTitle, counts, fmt === 'currency' ? 'by value' : 'by count'), p.parts, fmt)
            if (c) (c.tone === 'warn' ? watch : moved).push(c)
            break
          }
          case 'stacked': {
            const name = cardName(rawTitle, counts, period.kind === 'window' && period.grain ? `by ${period.grain}` : null)
            for (const line of trendLines(name, p, period, input.today)) {
              (line.tone === 'good' ? wins : line.tone === 'warn' || line.tone === 'bad' ? watch : moved).push(line)
            }
            break
          }
          case 'table': {
            const t = tableLine(rawTitle, p)
            if (t) watch.push(t)
            break
          }
          case 'attention':
            watch.push(...attentionLines(p))
            break
        }
      }

      const judged = judgedKpis(kpis)
      /* ⚠ Aggregated into ONE line each rather than a bullet per tile. On a
       * twenty-card board a bullet per tile is the board again in prose; a single
       * line naming which figures are green and which are flagged is the scan the
       * reader came for. */
      if (judged.wins.length) {
        wins.push({ text: `Reading well: ${nameSome(judged.wins, cap)}.`, tone: 'good' })
      }
      if (judged.watch.length) {
        watch.push({ text: `Flagged on this board: ${nameSome(judged.watch, cap)}.`, tone: 'warn' })
      }
      for (const m of judged.moved) {
        (m.tone === 'good' ? wins : m.tone === 'bad' || m.tone === 'warn' ? watch : moved).push(m)
      }
      watch.push(...personVsLine(input.siblings, input))

      /* Neutral observations fill whatever room is left, so a board with nothing
       * wrong still says something rather than reading as broken. */
      const winLines = [...wins, ...moved.filter(m => m.tone !== 'warn' && m.tone !== 'bad')].slice(0, cap)
      const watchLines = watch.slice(0, cap)

      /* ── the foot: what this did NOT read ─────────────────────────────────
       * The accepted cost of a templated narrator is uneven coverage, so it has to
       * declare it. A card that says nothing about four of twenty-three cards while
       * looking authoritative is the failure mode. */
      const total = input.siblings.length
      const periods = new Map<string, number>()
      for (const s of input.siblings) {
        const per = cardPeriod(s)
        if (per.kind === 'none') continue
        const key = per.kind === 'asOfToday' ? 'today' : `${per.start}..${per.end}`
        periods.set(key, (periods.get(key) ?? 0) + 1)
      }
      const asOf = periods.get('today') ?? 0
      const dated = [...periods.entries()].filter(([k]) => k !== 'today')
      const boardKey = `${win.start}..${win.end}`
      const otherWindows = dated.filter(([k]) => k !== boardKey)

      const foot: string[] = []
      foot.push(`Read ${read} of ${total} ${plural(total, 'card')} on this board.`)
      if (failed) foot.push(`${failed} could not be loaded.`)
      if (unreadKinds.size) {
        foot.push(`Written summaries and maps are left out — this card reads figures, not other people's sentences.`)
      }
      if (asOf) {
        foot.push(`${asOf} ${plural(asOf, 'card')} ${plural(asOf, 'shows', 'show')} where things stand today rather than over ${win.phrase}, because the recurring book has no dates — nothing here says whether those moved during the period.`)
      }
      if (otherWindows.length) {
        const spans = otherWindows.map(([k, n]) => {
          const [s, e] = k.split('..')
          return `${n} ${plural(n, 'card')} covering ${shortDate(s)} – ${shortDate(e)}`
        })
        foot.push(`⚠ Not every card covers the same period: ${nameSome(spans, 3)}, against ${win.phrase} for the rest. Figures from different periods cannot be compared with each other.`)
      }
      if (goals.invite) {
        foot.push(`Add a Goals card to this board and the first section will read your targets too.`)
      }

      return {
        kind: 'narrative',
        title: 'What the Numbers Say — This Board',
        sub: `${win.label} · reads the other cards on this board, not the whole business`,
        sections: [
          {
            key: 'goals',
            heading: 'Against your targets',
            tone: 'neutral',
            lines: goals.lines.slice(0, cap + 1),
            empty: goals.present
              ? 'No targets to measure in this range.'
              : 'No Goals card on this board yet, so there is nothing to measure against.',
          },
          {
            key: 'wins',
            heading: 'Wins',
            tone: 'good',
            lines: winLines,
            empty: 'Nothing on this board is reading as a clear win yet.',
          },
          {
            key: 'watch',
            heading: 'Worth a look',
            tone: 'warn',
            lines: watchLines,
            empty: 'Nothing on this board is flagged.',
          },
        ],
        foot: foot.join(' '),
      } satisfies NarrativePayload
    },
  },
]
