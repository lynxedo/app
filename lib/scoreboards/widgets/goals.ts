/* Goals & Targets widgets — the library behind Report §8.11.
 *
 * The only report section that measures against something a human typed rather
 * than something the business did, which creates one failure mode the others do
 * not have: a target with no actual behind it still looks authoritative. So
 * every figure here names the period it was judged over, and a metric whose
 * actual could not be computed says "unknown" rather than scoring zero.
 *
 * ⚠⚠ PACE IS ONLY SHOWN FOR METRICS THAT ACCUMULATE. Invoiced, collected, leads
 * and value sold pile up through a period, so "you should be at £X by now" is
 * real guidance. A close rate does not accumulate — being 40% through the month
 * does not mean you should have 40% of your close rate — so rate metrics show
 * attainment and NO pace. The source returns `expected_by_now: null` for them
 * and these cards leave the column blank rather than inventing a number.
 *
 * ⚠ Actuals are computed over each goal's OWN period, not the range at the top
 * of the screen: an August target is judged against August whatever window is
 * selected. The range decides which goals are listed, nothing more.
 *
 * ⚠⚠ A target belongs either to the company or to ONE PERSON, and every card
 * here says which — a row reading "90%" means something very different about the
 * business than about Mike. A person's actual comes from `scoreboard_people`, the
 * same composer the People report and commission are built on, so a person's goal
 * cannot disagree with the report it is judged against. Only four measures can be
 * scoped to a person at all; `lib/reports/goals.ts` documents why the other three
 * cannot, and both the API and the target screen refuse them.
 */

import { formatCurrency, formatDurationSec } from '@/lib/format'
import {
  GOAL_METRICS, getGoalMetric, periodLabel, nameList,
  rateMetricLabels, perPersonMetricLabels, lowerIsBetterMetricLabels,
  isCloseDateMetric, closeDateMetricLabels,
} from '@/lib/reports/goals'
import type { GoalRow, GoalsRow } from './sources'
import type { SourceBag, WidgetConfig, WidgetDef, WindowSpec } from './types'
import type { TargetRow, Tone, WidgetPayload } from './payloads'

/** How many measures accumulate, for the foot note's arithmetic. */
const GOAL_CUMULATIVE_COUNT = GOAL_METRICS.filter(m => m.cumulative).length

const goalsReq = (win: WindowSpec) => ({
  source: 'goals' as const,
  params: { start: win.start, end: win.end },
})

function data(bag: SourceBag, win: WindowSpec): GoalsRow | null {
  return bag.get<GoalsRow>(goalsReq(win))[0] ?? null
}

function num(v: number | string | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Render a value in its metric's own units.
 *
 * ⚠⚠ `decimals` exists because money targets in this product span three orders of
 * magnitude. Rounded to whole dollars, a $91.81 revenue-per-hour actual against a
 * $100.00 target prints "$92 of $100" — which is 92%, sitting beside an attainment
 * that correctly says 91.8%. Two figures on one row contradicting each other is worse
 * than either rounding on its own, so the caller decides ONCE per row (see
 * `moneyDecimals`) and every figure on that row is formatted the same way.
 */
function fmt(metricKey: string, v: number | null | undefined, decimals = 0): string {
  if (v == null) return '—'
  const m = getGoalMetric(metricKey)
  if (!m) return String(v)
  if (m.format === 'currency') return formatCurrency(num(v), { decimals })
  if (m.format === 'percent') return `${num(v)}%`
  // Held in seconds so it matches the report's own figure; read back as a time,
  // because "300" beside a reply-time target tells nobody it means five minutes.
  if (m.format === 'duration') return formatDurationSec(num(v), { style: 'verbose', seconds: true })
  return num(v).toLocaleString()
}

/**
 * Whose target this is, for display.
 *
 * ⚠ A person target whose name could not be resolved says so rather than falling
 * back to "Company" — mislabelling one person's number as the whole business's is
 * the one error this column exists to prevent.
 */
function whose(g: GoalRow): string {
  if (!g.employee_id) return 'Company'
  return g.person_name || 'Someone no longer on the roster'
}

/**
 * The target as it should read.
 *
 * ⚠ A ceiling is marked "≤". Without it a labour-cost row showing "22%" beside an
 * actual of 23.8% looks like a target that was beaten, since every other row on
 * the table is a floor.
 */
function fmtTarget(g: GoalRow, decimals = 0): string {
  const t = fmt(g.metric, g.target, decimals)
  return g.direction === 'lower' ? `≤ ${t}` : t
}

/**
 * How many decimals every money figure on this target's row should carry.
 *
 * ⚠ Decided from the TARGET's size, not from each value's own — so the actual, the
 * target and the gap on one line always agree about precision. A rate target ($100 an
 * hour) needs cents to stay consistent with its own percentage; a $750,000 year does
 * not, and cents there would be noise.
 */
function moneyDecimals(g: GoalRow): number {
  return getGoalMetric(g.metric)?.format === 'currency' && Math.abs(num(g.target)) < 1000 ? 2 : 0
}

/* ── Whose targets a card shows ─────────────────────────────────────────────
 *
 * Ben: "we need to overhaul the goal widgets so we can just show one person's goal
 * on a scoreboard."
 *
 * ⚠⚠ Applied in the pure metric, never pushed into the source — the same property
 * every other person filter in the library relies on (see people-filter.ts). The
 * filter can only REMOVE rows the viewer was already sent, so it composes with the
 * report gate rather than reaching around it, and a Mike card plus a company card on
 * one board still cost ONE round trip.
 *
 * ⚠⚠ Matched on `employee_id`, not on a name. This is the only picker in the library
 * that can do that — every chart elsewhere carries only a name, while a goal row
 * carries the roster id the target is stored against. So the filter keeps working
 * after somebody's preferred name changes, which the name-matched pickers knowingly
 * cannot.
 *
 * ⚠ "The company only" exists because a shared board should not start listing
 * everybody's personal targets the day somebody sets one — and the reverse: a
 * person's own card showing the company's number beside theirs reads as theirs.
 */
const WHOSE_EVERYONE = 'Everyone'
const WHOSE_COMPANY = 'The company only'
const WHOSE_PEOPLE = 'Only the people I pick'

const GRAIN_ANY = 'Any length'
const GRAIN_LABELS: Record<GoalRow['grain'], string> = {
  month: 'Monthly targets only',
  quarter: 'Quarterly targets only',
  year: 'Yearly targets only',
}
/** ⚠ The stored value is the LABEL, like every other enum field, so this maps back. */
const GRAIN_BY_LABEL: Record<string, GoalRow['grain']> = {
  [GRAIN_LABELS.month]: 'month',
  [GRAIN_LABELS.quarter]: 'quarter',
  [GRAIN_LABELS.year]: 'year',
}

const GOAL_SCOPE_CONFIG = {
  whose: {
    kind: 'enum' as const,
    label: 'Whose targets',
    def: WHOSE_EVERYONE,
    opts: [WHOSE_EVERYONE, WHOSE_COMPANY, WHOSE_PEOPLE],
    hint: 'Company-wide targets are left off a card built for particular people, so somebody\u2019s own scoreboard shows their number and not the whole business\u2019s beside it.',
  },
  people: {
    kind: 'catalog' as const,
    label: 'Which people',
    def: [] as string[],
    catalog: 'goal_people' as const,
    hint: 'Only used when "Whose targets" is set to the people you pick. Lists only people who already hold a target.',
  },
  /* ── Which measure, and over what length of period ────────────────────────
   *
   * Ben: "I would like to be able to filter it down even more to particular goals.
   * This is showing all company goals, but what if I just want to highlight one
   * goal?"
   *
   * ⚠⚠ IT TAKES THREE CONTROLS TO REACH ONE TARGET, not two, and the third is the
   * one nobody predicts. Picking "Work produced" for "Mike Cyplik" still matches TWO
   * of his real targets — a $25,000 monthly and a $300,000 yearly — so without a
   * period length a card set to one goal quietly draws two rows. Found in Heroes'
   * own data while mocking this up, not in review.
   *
   * ⚠ Both default to everything, so a board saved before these existed draws
   * exactly what it drew yesterday.
   */
  metrics: {
    kind: 'catalog' as const,
    label: 'Which goals',
    def: [] as string[],
    catalog: 'goal_metrics' as const,
    hint: 'Leave empty for every goal. Lists only measures somebody has actually set a target on.',
  },
  grain: {
    kind: 'enum' as const,
    label: 'Period length',
    def: GRAIN_ANY,
    opts: [GRAIN_ANY, GRAIN_LABELS.month, GRAIN_LABELS.quarter, GRAIN_LABELS.year],
    hint: 'What separates a monthly target from a yearly one on the same measure — somebody can hold both at once.',
  },
}

type GoalScope = {
  mode: 'everyone' | 'company' | 'people'
  ids: Set<string>
  /** Metric keys to keep. Empty means every measure. */
  metrics: Set<string>
  /** Period length to keep, or null for any length. */
  grain: GoalRow['grain'] | null
  /** Showing less than everything, so the card has to say so. */
  narrowed: boolean
  /**
   * Set to people, but nobody picked yet. ⚠ Its own state on purpose: rendering
   * everyone would contradict the setting, and rendering an empty card with no
   * explanation reads as "this person has no targets" when nothing was chosen.
   */
  unset: boolean
}

/**
 * ⚠ An unrecognised or absent `whose` means EVERYONE, which is both the old behaviour
 * (so every board saved before this setting existed is unchanged) and the safe
 * direction: the scope is a DISPLAY choice, not a permission. Anyone who can see a
 * Goals card already holds the Goals report grant, which shows every target — so
 * failing open widens nothing.
 */
function goalScope(cfg: WidgetConfig): GoalScope {
  const whose = String(cfg.whose ?? WHOSE_EVERYONE)
  const raw = cfg.people
  const ids = new Set(
    (Array.isArray(raw) ? raw.map(String).map(v => v.trim()).filter(Boolean) : []),
  )
  const rawMetrics = cfg.metrics
  // ⚠ Bounded, not whitelisted, like every catalog field — but a key nothing
  // recognises simply matches no row, so an unknown value narrows to empty rather
  // than widening. Failing to an empty card is the safe direction for a filter.
  const metrics = new Set(
    (Array.isArray(rawMetrics) ? rawMetrics.map(String).map(v => v.trim()).filter(Boolean) : []),
  )
  const grain = GRAIN_BY_LABEL[String(cfg.grain ?? GRAIN_ANY)] ?? null
  const mode = whose === WHOSE_COMPANY ? 'company' : whose === WHOSE_PEOPLE ? 'people' : 'everyone'
  return {
    mode,
    ids,
    metrics,
    grain,
    narrowed: mode !== 'everyone' || metrics.size > 0 || grain !== null,
    unset: mode === 'people' && ids.size === 0,
  }
}

function keepGoal(g: GoalRow, s: GoalScope): boolean {
  if (s.metrics.size > 0 && !s.metrics.has(g.metric)) return false
  if (s.grain !== null && g.grain !== s.grain) return false
  if (s.mode === 'company') return !g.employee_id
  if (s.mode === 'people') return !!g.employee_id && s.ids.has(g.employee_id)
  return true
}

/** The rows this card should draw, plus the scope that produced them. */
function scoped(bag: SourceBag, cfg: WidgetConfig, win: WindowSpec):
  { r: GoalsRow | null; goals: GoalRow[]; scope: GoalScope } {
  const r = data(bag, win)
  const scope = goalScope(cfg)
  const all = r?.goals ?? []
  return { r, goals: scope.unset ? [] : all.filter(g => keepGoal(g, scope)), scope }
}

/**
 * Whose targets this card is about, in words.
 *
 * ⚠ Names are resolved from the ROWS rather than the config, because the config holds
 * ids. A person with no target in the window therefore cannot be named — the count is
 * the fallback, which is honest rather than blank.
 */
function whosePhrase(s: GoalScope, goals: GoalRow[]): string | null {
  if (s.mode === 'company') return 'company-wide targets only'
  if (s.mode !== 'people') return null
  if (s.unset) return 'nobody picked yet'
  const names = [...new Set(goals.filter(g => g.employee_id && g.person_name).map(g => g.person_name as string))]
  if (names.length === 1 && s.ids.size === 1) return `${names[0]} only`
  if (names.length > 1 && names.length <= 3 && names.length === s.ids.size) return `${names.join(' + ')} only`
  return `${s.ids.size} ${s.ids.size === 1 ? 'person' : 'people'} only`
}

/**
 * Which measures the card is pinned to, in words.
 *
 * ⚠ Named from the CATALOG rather than from the rows, unlike the people phrase above.
 * A metric key resolves to its label with no data at all, so a card filtered to a
 * measure that has no target in this range can still say which measure it is looking
 * for — which is the difference between "Work produced: nothing here" and a blank card.
 */
function metricsPhrase(s: GoalScope): string | null {
  if (s.metrics.size === 0) return null
  // ⚠ A key that has left the catalog is named as retired rather than printed raw —
  // a card titled "— rev_per_labor_hour" reads as a bug rather than as a stale setting.
  const labels = [...s.metrics].map(k => getGoalMetric(k)?.label ?? 'a goal no longer available')
  if (labels.length <= 2) return labels.join(' + ')
  return `${labels.length} goals`
}

function grainPhrase(s: GoalScope): string | null {
  if (s.grain === null) return null
  return s.grain === 'month' ? 'monthly targets' : s.grain === 'quarter' ? 'quarterly targets' : 'yearly targets'
}

/**
 * Everything this card is narrowed to, in words.
 *
 * ⚠ Dot-joined to match how the subtitles and the board narrator already join their
 * clauses — the narrator wraps this in brackets, so a comma list would read as prose
 * inside a card that punctuates with dots everywhere else.
 */
function scopePhrase(s: GoalScope, goals: GoalRow[]): string | null {
  const parts = [whosePhrase(s, goals), metricsPhrase(s), grainPhrase(s)].filter(Boolean) as string[]
  return parts.length ? parts.join(' · ') : null
}

/**
 * Put the scope in the TITLE too: a tile reading "2 of 3" says nothing about whose.
 *
 * ⚠ WHOSE, then the measure — and only one of them. A title carrying every filter
 * ("Progress toward each target — Mike Cyplik — Work produced — monthly") is worse
 * than one that names the most distinguishing fact and leaves the rest to the
 * subtitle, which spells all of it out. Whose wins when both are set, because two
 * cards showing the same measure for different people is the pairing a reader is
 * most likely to mix up.
 */
function scopeTitle(title: string, s: GoalScope, goals: GoalRow[]): string {
  if (!s.narrowed) return title
  const who = s.unset
    ? null
    : s.mode === 'company'
      ? 'company'
      : s.mode === 'people'
        ? (() => {
            const names = [...new Set(goals.filter(g => g.employee_id && g.person_name).map(g => g.person_name as string))]
            if (names.length === 1 && s.ids.size === 1) return names[0]
            return `${s.ids.size} ${s.ids.size === 1 ? 'person' : 'people'}`
          })()
        : null
  const suffix = who ?? metricsPhrase(s)
  return suffix ? `${title} — ${suffix}` : title
}

/**
 * The period a row covers, saying when it is the STANDING target for that grain.
 *
 * ⚠ Worth the words: "$50,000 · missed" reads differently when the number is the
 * monthly target that has always been there than when somebody chose it for that
 * month, and the table would otherwise show the two identically.
 */
function periodCell(g: GoalRow): string {
  const label = periodLabel(g.grain, g.period_start)
  if (!g.repeating) return label
  const noun = g.grain === 'month' ? 'monthly' : g.grain === 'quarter' ? 'quarterly' : 'yearly'
  return `${label} · ${noun} target`
}

function withScope(sub: string, s: GoalScope, goals: GoalRow[]): string {
  const p = scopePhrase(s, goals)
  return p ? `${sub} · ${p}` : sub
}

/**
 * What an empty card should say, which depends on WHY it is empty.
 *
 * \u26a0\u26a0 THE MEASURE AND PERIOD FILTERS GET NAMED FIRST, before whose. A card pinned to
 * "Work produced \u00b7 monthly" for a person who only holds a yearly one is empty because
 * of the PERIOD LENGTH, and telling them "nobody picked has a target in this range"
 * sends them to change the wrong control \u2014 they would go adding people to a card that
 * was never going to match.
 *
 * \u26a0 The read is capped at 60 targets, so a filter that finds nothing has two possible
 * causes and this says which one applies rather than guessing.
 */
function emptyBecause(s: GoalScope, r: GoalsRow | null): string {
  if (s.unset) return 'Pick at least one person in this card\u2019s settings.'
  const narrowedBy = [metricsPhrase(s), grainPhrase(s)].filter(Boolean) as string[]
  if (narrowedBy.length > 0) {
    const capped = r && r.total_in_window > r.shown
      ? ` Only the ${r.shown} most recent of ${r.total_in_window} targets were read, so it may exist outside that.`
      : ''
    return `No target matches ${narrowedBy.join(' \u00b7 ')} in this range.${capped}`
  }
  if (s.mode === 'people') return 'None of the people picked have a target in this range.'
  if (s.mode === 'company') return 'No company-wide targets in this range.'
  return r && r.total_in_window === 0
    ? 'No targets set yet. An admin can add them in Admin → Reports.'
    : 'No targets in this range.'
}

const STATUS_TEXT: Record<GoalRow['status'], string> = {
  hit: 'Hit',
  missed: 'Missed',
  on_track: 'On track',
  behind: 'Behind',
  // A rate is judged against the target itself, so it is "under", not "behind" —
  // behind implies a pace it does not have.
  under: 'Under target',
  // ⚠ The ceiling twin of "under". Being under a cost target is the GOOD outcome,
  // so the two verdicts cannot share a word.
  over: 'Over target',
  // ⚠ The figure is real; the verdict is not due yet. See the header.
  pending: 'Too early to call',
  open: 'Not started',
  unknown: 'No data',
}

/* ── Drawing a target ───────────────────────────────────────────────────────
 *
 * Everything below turns one `GoalRow` into one `TargetRow`. It exists because the
 * card this replaces drew a single bar from `attainment_pct` and nothing else, which
 * is wrong in three different ways at once — a ceiling that has been blown scores
 * high, an overshoot has nowhere to go past 100%, and a rate has no pace but was
 * drawn as though it did.
 */

/**
 * Where a ceiling's limit sits on the track.
 *
 * ⚠ FIXED rather than proportional, on purpose. Two ceiling rows on one card then
 * put their limit lines at the same place, so the eye compares the overspill instead
 * of hunting for where each line landed.
 */
const CEILING_LIMIT_FRAC = 0.7

type TargetGeometry = Pick<TargetRow, 'fillFrac' | 'limitFrac' | 'overFrac' | 'paceFrac'>

/**
 * ⚠ Guard the denominator. A target of zero is settable for a count measure, and
 * `actual / 0` would hand the renderer Infinity — which draws as a full bar, the most
 * confident possible way to show a number nobody can compute.
 */
function geometry(g: GoalRow): TargetGeometry {
  const target = num(g.target)
  const actual = g.actual == null ? null : num(g.actual)
  const pace = g.cumulative && g.expected_by_now != null ? num(g.expected_by_now) : null

  // An empty track beside a named target is the honest picture; the status word
  // beside it already reads "No data".
  if (actual === null || target === 0) return { fillFrac: 0 }

  if (g.direction === 'lower') {
    /* A CEILING. The limit is a line the bar can cross, and the part past it is
     * drawn in the bad tone by the renderer.
     *
     * ⚠⚠ THIS IS THE FIX FOR THE WORST BUG IN THE OLD CARD. Josh at 34.1% against a
     * ≤25% limit has an inverted attainment of 73.3%, so it drew as a bar
     * three-quarters full — "nearly there" for nine points over budget. */
    const extent = Math.min(1, CEILING_LIMIT_FRAC * (actual / target))
    const over = Math.max(0, extent - CEILING_LIMIT_FRAC)
    return {
      fillFrac: Math.min(extent, CEILING_LIMIT_FRAC),
      limitFrac: CEILING_LIMIT_FRAC,
      overFrac: over > 0 ? over : undefined,
      paceFrac: pace === null ? undefined : Math.min(1, CEILING_LIMIT_FRAC * (pace / target)),
    }
  }

  // A FLOOR still short of its number: the target IS the end of the track, so no
  // line is needed — the empty part of the track is the gap.
  if (actual <= target) {
    return {
      fillFrac: actual / target,
      paceFrac: pace === null ? undefined : Math.min(1, pace / target),
    }
  }

  /* A FLOOR that has been beaten. Rescale so the actual fills the track and the
   * target becomes a line the bar has cleared.
   *
   * ⚠ NOT drawn as overspill. The red band means "past a limit", and beating a sales
   * target is not a breach — the bar stays in its own good tone the whole way. */
  return {
    fillFrac: 1,
    limitFrac: target / actual,
    paceFrac: pace === null ? undefined : Math.min(1, pace / actual),
  }
}

/**
 * A difference in the measure's own units.
 *
 * ⚠ A percentage target's gap is in POINTS. "9.1% over" printed beside a 34.1% actual
 * reads as 9.1% *of* 34.1% — the one place on this card where the right units and the
 * obvious units are not the same.
 */
function gapText(metricKey: string, diff: number, decimals = 0): string {
  const v = Math.abs(diff)
  if (getGoalMetric(metricKey)?.format === 'percent') {
    const r = Math.round(v * 10) / 10
    return `${r} ${r === 1 ? 'point' : 'points'}`
  }
  return fmt(metricKey, v, decimals)
}

/** "of $750,000" for a floor; "limit ≤ 25%" for a ceiling, which is not the same claim. */
function targetLabel(g: GoalRow, decimals: number): string {
  return g.direction === 'lower'
    ? `limit ${fmtTarget(g, decimals)}`
    : `of ${fmt(g.metric, g.target, decimals)}`
}

/**
 * The line under the bar: how far off, and how much of the period is gone.
 *
 * ⚠⚠ MID-PERIOD, THE GAP THAT MATTERS IS THE GAP TO PACE, NOT TO THE TARGET. Being
 * $270,944 short of a $750,000 year on the last day of August is true and useless;
 * being $20,259 behind where the calendar says you should be is the number somebody
 * can act on. So a running total mid-period reports pace, and only a finished period
 * (or a rate, which has no pace) reports the distance to the target itself.
 */
function detailText(g: GoalRow, decimals: number): string {
  const target = num(g.target)
  const actual = g.actual == null ? null : num(g.actual)

  if (actual === null) {
    return g.status === 'open'
      ? 'This period has not started yet.'
      : 'Nothing measurable for this period yet.'
  }

  const parts: string[] = []

  // ⚠ Attainment is left off a ceiling. Its percentage is inverted, so "73% of
  // target" for nine points over budget is the exact misreading this card exists
  // to prevent — the gap in points below says it properly.
  if (g.direction !== 'lower' && g.attainment_pct != null) {
    parts.push(`${num(g.attainment_pct)}% of target`)
  }

  if (g.cumulative && !g.closed && g.expected_by_now != null) {
    const d = actual - num(g.expected_by_now)
    parts.push(Math.abs(d) < 0.005
      ? 'exactly on pace'
      : `${gapText(g.metric, d, decimals)} ${d < 0 ? 'behind' : 'ahead of'} pace`)
  } else {
    const d = actual - target
    if (Math.abs(d) < 0.005) {
      parts.push('exactly on target')
    } else if (g.direction === 'lower') {
      parts.push(`${gapText(g.metric, d, decimals)} ${d > 0 ? 'over the limit' : 'under the limit'}`)
    } else {
      parts.push(`${gapText(g.metric, d, decimals)} ${d < 0 ? 'short' : 'over target'}`)
    }
  }

  parts.push(num(g.elapsed_pct) >= 100 ? 'the period has ended' : `${num(g.elapsed_pct)}% of the period gone`)

  // Said on the row itself, not just in the footnote — somebody reading one row
  // should not have to work out why it has no marker when its neighbour does.
  if (!g.cumulative) parts.push('a rate, so no pace marker')
  if (g.status === 'pending') parts.push('no verdict until the period ends')

  return parts.join(' · ')
}


const STATUS_TONE: Record<GoalRow['status'], Tone> = {
  hit: 'good',
  missed: 'bad',
  on_track: 'good',
  behind: 'warn',
  under: 'warn',
  over: 'warn',
  // Neutral, deliberately: an unfinished retention year is not a warning.
  pending: 'neutral',
  open: 'neutral',
  unknown: 'unknown',
}

function targetRow(g: GoalRow): TargetRow {
  const dp = moneyDecimals(g)
  return {
    key: g.id,
    name: getGoalMetric(g.metric)?.label ?? g.metric,
    // ⚠ Whose it is comes FIRST. A row of targets with no owner reads as company
    // performance, which is how a personal number gets repeated as the business's.
    who: [g.employee_id ? whose(g) : 'Company', periodCell(g)].join(' · '),
    actualText: fmt(g.metric, g.actual, dp),
    targetText: targetLabel(g, dp),
    status: STATUS_TEXT[g.status],
    detail: detailText(g, dp),
    tone: STATUS_TONE[g.status],
    ...geometry(g),
  }
}

/**
 * Worst first.
 *
 * ⚠ Deterministic, and not the source's order. The old card drew whatever order the
 * database returned (by person, then measure), which buries the one target in trouble
 * under five that are fine. Ties break on the name so a card does not reshuffle
 * itself between two renders of the same data.
 */
const TARGET_SEVERITY: Record<GoalRow['status'], number> = {
  missed: 0, behind: 1, over: 2, under: 3, pending: 4, unknown: 5, open: 6, on_track: 7, hit: 8,
}

function byWorstFirst(a: GoalRow, b: GoalRow): number {
  const d = TARGET_SEVERITY[a.status] - TARGET_SEVERITY[b.status]
  if (d !== 0) return d
  return (getGoalMetric(a.metric)?.label ?? a.metric).localeCompare(getGoalMetric(b.metric)?.label ?? b.metric)
}

/** What the markers mean, said once under the rows rather than in a colour legend. */
const MARKER_FOOT = 'The pale mark on a bar is where today says you should be; a white mark is the target itself. Neither appears on a measure that is a rate rather than a running total — a rate does not build up through a period, so there is no honest half-way figure.'

export const GOALS_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'kpi_goals_on_track',
    group: 'Goals',
    title: 'Goals on track',
    blurb: 'How many targets are being met',
    defaultSpan: 3,
    config: { ...GOAL_SCOPE_CONFIG },
    sources: (_cfg, win) => [goalsReq(win)],
    metric: (bag, cfg, win) => {
      const { r, goals, scope } = scoped(bag, cfg, win)
      // ⚠ A target with no verdict due yet is left out of BOTH halves rather than
      // counted against you. An annual retention goal reads 'pending' all year, so
      // scoring it as "not on track" would make this tile say 3 of 4 for a business
      // doing nothing wrong.
      const open = goals.filter(g => !g.closed)
      // ⚠ Two kinds of target are left out of BOTH halves rather than counted
      // against you: one whose verdict is not due yet, and one nothing can measure.
      // Found by rendering a real board — a stale measure and an unfinished
      // retention year were both being scored as "not on track", so the tile read
      // 2 of 8 for a business that was failing neither.
      const live = open.filter(g => g.status !== 'pending' && g.status !== 'unknown')
      const waiting = open.filter(g => g.status === 'pending').length
      const unmeasured = open.filter(g => g.status === 'unknown').length
      const good = live.filter(g => g.status === 'hit' || g.status === 'on_track').length
      if (!r || live.length === 0) {
        return {
          kind: 'kpi',
          label: scopeTitle('Goals on track', scope, goals),
          value: '—',
          sub: waiting || unmeasured
            ? `${waiting + unmeasured} target${waiting + unmeasured === 1 ? '' : 's'} open, none of them judgeable yet`
            : emptyBecause(scope, r),
        }
      }
      return {
        kind: 'kpi',
        label: scopeTitle('Goals on track', scope, goals),
        value: `${good} of ${live.length}`,
        tone: good === live.length ? 'good' : good === 0 ? 'bad' : 'warn',
        judged: true,
        sub: [
          withScope(`${win.phrase} · targets still open`, scope, goals),
          waiting ? `${waiting} not judged until the period ends` : null,
          unmeasured ? `${unmeasured} with no data to measure` : null,
        ].filter(Boolean).join(' · '),
      }
    },
  },

  {
    type: 'kpi_goals_hit',
    group: 'Goals',
    title: 'Targets hit',
    blurb: 'Finished periods that made their number',
    defaultSpan: 3,
    config: { ...GOAL_SCOPE_CONFIG },
    sources: (_cfg, win) => [goalsReq(win)],
    metric: (bag, cfg, win) => {
      const { r, goals, scope } = scoped(bag, cfg, win)
      // ⚠ Same rule as the tile beside it: a finished target nothing could measure
      // is not a target that was missed.
      const finished = goals.filter(g => g.closed)
      const closed = finished.filter(g => g.status !== 'unknown')
      const unmeasured = finished.length - closed.length
      const hit = closed.filter(g => g.status === 'hit').length
      return {
        kind: 'kpi',
        label: scopeTitle('Targets hit', scope, goals),
        value: closed.length ? `${hit} of ${closed.length}` : '—',
        tone: closed.length === 0 ? 'neutral' : hit === closed.length ? 'good' : hit === 0 ? 'bad' : 'warn',
        judged: true,
        // Only finished periods count here: judging a month that is half over
        // as "missed" would make every current target look like a failure.
        sub: closed.length
          ? withScope(
              ['Periods that have finished', unmeasured ? `${unmeasured} had no data` : null]
                .filter(Boolean).join(' · '), scope, goals)
          : unmeasured
            ? `${unmeasured} finished target${unmeasured === 1 ? '' : 's'} had no data to measure`
            : scope.narrowed ? emptyBecause(scope, r) : 'No period has finished yet',
      }
    },
  },

  {
    type: 'goals_table',
    group: 'Goals',
    title: 'Goal vs actual',
    blurb: 'Every target, what it is at, and whether it is on pace',
    defaultSpan: 12,
    config: { ...GOAL_SCOPE_CONFIG },
    sources: (_cfg, win) => [goalsReq(win)],
    metric: (bag, cfg, win) => {
      const { r, goals, scope } = scoped(bag, cfg, win)
      const rows = goals.map(g => {
        const m = getGoalMetric(g.metric)
        // ⚠ The same per-row precision the progress cards use. Without it this table
        // shows "$92" for a $91.81 actual while the card beside it on the same board
        // shows "$91.81" — one target, two figures, and no way to tell which is right.
        const dp = moneyDecimals(g)
        return {
          key: g.id,
          cells: {
            metric: m?.label ?? g.metric,
            who: whose(g),
            period: periodCell(g),
            target: fmtTarget(g, dp),
            actual: fmt(g.metric, g.actual, dp),
            attainment: g.attainment_pct,
            // Blank, not zero, for a rate metric — see the header.
            pace: g.cumulative ? fmt(g.metric, g.expected_by_now, dp) : '—',
            status: STATUS_TEXT[g.status],
          },
          tones: { status: STATUS_TONE[g.status] } as Record<string, Tone>,
          meta: !m
            ? { text: 'This metric is no longer in the catalog', tone: 'unknown' as Tone }
            : g.closed
              ? undefined
              : { text: `${num(g.elapsed_pct)}% of the period gone`, tone: 'neutral' as Tone },
        }
      })
      // ⚠ `shown`/`total_in_window` describe what the report READ, before this card's
      // own filter, so the two facts are stated separately rather than one number
      // being made to stand for both.
      const truncated = r && r.total_in_window > r.shown
      return {
        kind: 'table',
        title: scopeTitle('Goal vs actual', scope, goals),
        sub: r ? withScope(`${rows.length} target${rows.length === 1 ? '' : 's'} overlapping ${win.phrase}`, scope, goals) : win.phrase,
        columns: [
          { key: 'metric', label: 'Goal', align: 'left' },
          { key: 'who', label: 'Whose', align: 'left' },
          { key: 'period', label: 'Period', align: 'left' },
          { key: 'target', label: 'Target', align: 'right' },
          { key: 'actual', label: 'Actual', align: 'right' },
          { key: 'attainment', label: 'Attainment', align: 'right', format: 'percent', sortable: true },
          { key: 'pace', label: 'Should be at', align: 'right', title: 'The target prorated to today. Blank for rates, which do not accumulate.' },
          { key: 'status', label: 'Status', align: 'left' },
        ],
        rows,
        empty: emptyBecause(scope, r),
        foot: [
          // Never let a capped list read as the whole list.
          truncated
            ? `Only the ${r!.shown} most recent of ${r!.total_in_window} targets in this range were read.`
            : null,
          // ⚠ This used to name close rate and revenue per hour, which was true when
          // they were the only two rates. With a dozen, the rule is the honest form
          // — a list here goes stale the moment a measure is added while still
          // reading as authoritative.
          `"Should be at" is the target prorated to today. It is blank for any measure that is a rate rather than a running total (${rateMetricLabels().length} of the ${rateMetricLabels().length + GOAL_CUMULATIVE_COUNT} are): a rate does not build up through a period, so there is no honest half-way number.`,
        ].filter(Boolean).join(' '),
      }
    },
  },

  /**
   * Every open target, worst first.
   *
   * ⚠⚠ REBUILT from a `bars` card, and the reason is worth keeping. It drew ONE
   * number per target — `attainment_pct` — with the name clamped to a 104px column by
   * the shared bar renderer. Ben's own board therefore read "Revenue per labo… 91.8%"
   * and "Work produced ·… 63.9%": two amber bars of the same shape that were in fact
   * a rate $8.19/hr short and a year $20,259 behind pace. Neither figure, neither
   * full name, and no way to tell the two situations apart.
   *
   * ⚠ A target with no actual is now LISTED rather than dropped. The old filter
   * required `attainment_pct != null`, so a measure nothing could compute vanished
   * from a card whose whole job is to say where things stand — and vanishing is
   * indistinguishable from never having been set. It draws an empty track and says
   * "No data", which is what the rest of this file already does everywhere else.
   */
  {
    type: 'goals_progress',
    group: 'Goals',
    title: 'Progress toward each target',
    blurb: 'Each open goal against its number, with where you should be by now',
    defaultSpan: 6,
    config: { ...GOAL_SCOPE_CONFIG },
    sources: (_cfg, win) => [goalsReq(win)],
    metric: (bag, cfg, win) => {
      const { r, goals, scope } = scoped(bag, cfg, win)
      const live = goals.filter(g => !g.closed).sort(byWorstFirst)
      const truncated = r && r.total_in_window > r.shown
      return {
        kind: 'targets',
        layout: 'rows',
        title: scopeTitle('Progress toward each target', scope, goals),
        sub: withScope(`${win.phrase} · targets still open`, scope, goals),
        rows: live.map(targetRow),
        empty: scope.narrowed || scope.unset ? emptyBecause(scope, r) : 'No open targets in this range',
        legend: [
          { label: 'On track or hit', tone: 'good' },
          { label: 'Behind or under', tone: 'warn' },
          { label: 'Missed or over a limit', tone: 'bad' },
        ],
        foot: [
          truncated
            ? `Only the ${r!.shown} most recent of ${r!.total_in_window} targets in this range were read.`
            : null,
          'Worst first.',
          MARKER_FOOT,
        ].filter(Boolean).join(' '),
      }
    },
  },

  /**
   * ONE target, big.
   *
   * Ben: "You don't see what the actual goal is, just the progress… what if I just
   * want to highlight one goal?"
   *
   * ⚠⚠ IT SHOWS THE FIRST MATCH AND SAYS HOW MANY OTHERS MATCHED, rather than
   * silently picking. Three controls are needed to reach exactly one target (see
   * GOAL_SCOPE_CONFIG) and somebody will inevitably set two of them, so a card that
   * quietly drew one of four matches would be a card that shows a different number
   * after somebody else adds a target. The footnote names the control to reach for.
   *
   * ⚠ Unlike the stacked card, this one includes a FINISHED period. A card pinned to
   * "Work produced · monthly" going blank the day the month closes would read as
   * broken; the newest period wins, whether or not it is still open.
   */
  {
    type: 'goal_single',
    group: 'Goals',
    title: 'Single target',
    blurb: 'One goal on its own card — pick which in the settings',
    defaultSpan: 4,
    config: { ...GOAL_SCOPE_CONFIG },
    sources: (_cfg, win) => [goalsReq(win)],
    metric: (bag, cfg, win) => {
      const { r, goals, scope } = scoped(bag, cfg, win)
      /* Newest period first, then the shorter grain, then worst — so "the current
       * month" beats "the year it sits inside", which is what somebody pinning a card
       * to a monthly target means by it. Fully deterministic: the same data always
       * picks the same target. */
      const grainRank: Record<GoalRow['grain'], number> = { month: 0, quarter: 1, year: 2 }
      const ranked = [...goals].sort((a, b) =>
        (b.period_start < a.period_start ? -1 : b.period_start > a.period_start ? 1 : 0)
        || (grainRank[a.grain] - grainRank[b.grain])
        || byWorstFirst(a, b))
      const pick = ranked[0]
      const others = ranked.length - 1
      return {
        kind: 'targets',
        layout: 'focus',
        // ⚠ Carried even though the focus layout writes its heading from the target
        // itself: the widget picker and the board editor both read `title`.
        title: scopeTitle('Single target', scope, goals),
        sub: withScope(win.phrase, scope, goals),
        rows: pick ? [targetRow(pick)] : [],
        // ⚠ Always the shared reason. This card can be left unconfigured, and an
        // unconfigured card that finds nothing is empty for the ordinary reason —
        // telling somebody to "pick a goal" when no target exists at all sends them
        // to the wrong screen.
        empty: emptyBecause(scope, r),
        foot: [
          others > 0
            ? `${others} other target${others === 1 ? ' also matches' : 's also match'} this card — showing the newest period. Set a period length, or pick one person, to pin it.`
            : null,
          pick && !pick.cumulative
            ? 'A rate, so there is no pace marker — a rate does not build up through a period.'
            : pick ? MARKER_FOOT : null,
        ].filter(Boolean).join(' '),
      }
    },
  },

  {
    type: 'goals_notes',
    group: 'Goals',
    title: 'How these are worked out',
    blurb: 'What a target is measured against',
    defaultSpan: 6,
    config: { ...GOAL_SCOPE_CONFIG },
    sources: (_cfg, win) => [goalsReq(win)],
    metric: (bag, cfg, win) => {
      const { r, goals, scope } = scoped(bag, cfg, win)
      const items = [
        'Each target is measured over its OWN period. An August target is judged against August, whatever range you pick above — the range only decides which targets are listed.',
        'Every actual comes from the report that owns that number, so a goal can never disagree with the report it is measured against.',
        '"Should be at" prorates the target to today. It is blank for any measure that is a rate rather than a running total: a rate does not accumulate through a period, so there is no honest half-way figure.',
      ]
      // ⚠ Each of the next three notes appears only when the thing it explains is
      // actually on screen. A board of plain revenue targets should not be taught
      // the rules for ceilings, people or retention it is not using.
      if (goals.some(g => g.direction === 'lower')) {
        items.push(
          `Some targets are ceilings rather than floors — ${nameList(lowerIsBetterMetricLabels())} are hit by coming in at or BELOW the number, and are shown with a "≤". Their progress is worked out the other way up, so 92% means over budget, not nearly there.`,
        )
      }
      // Only when such a target is actually on screen — same rule as every other note
      // here. A board of revenue targets should not be taught how sales are dated.
      if (goals.some(g => isCloseDateMetric(g.metric))) {
        items.push(
          `${nameList(closeDateMetricLabels())} count a deal in the period it was SOLD, not the period its lead came in \u2014 so a July enquiry closed in August belongs to August. That is the same rule commission is paid on, so a target and the bonus riding on it cannot disagree. \u26a0 The Sales report groups by the month a lead ARRIVED instead, because that is what a close rate means, so the two can show different totals for one month and both be right.`,
        )
      }
      if (goals.some(g => g.repeating)) {
        items.push(
          'A target marked "monthly target" (or quarterly, or yearly) was set once and applies to every period from then on, so each month is judged on its own. Setting a target for one specific month replaces the standing one for that month only.',
        )
      }
      if (scope.mode === 'people') {
        items.push(
          'This card is set to particular people, so company-wide targets are left off it — a personal scoreboard showing the whole business\u2019s number beside somebody\u2019s own would read as theirs.',
        )
      }
      if (scope.mode === 'company') {
        items.push(
          'This card is set to company-wide targets only, so nobody\u2019s personal targets appear on it.',
        )
      }
      // Same rule as every other note here: only when the thing it explains is
      // actually switched on.
      if (scope.metrics.size > 0) {
        items.push(
          `This card is pinned to ${metricsPhrase(scope)}, so any other target is left off it even when it belongs to the same person.`,
        )
      }
      if (scope.grain !== null) {
        items.push(
          `Only ${grainPhrase(scope)} appear on this card. That matters because the same measure can carry both at once \u2014 a monthly number and the yearly one it sits inside are different targets, and a card showing both looks like it is double-counting.`,
        )
      }
      if (goals.some(g => g.direction === 'lower')) {
        items.push(
          'On a ceiling target the white mark on the bar is the limit itself, not the end of the track, and anything past it is drawn in red. A ceiling that has been gone over cannot look like progress that way \u2014 which it did on the old bars, where being nine points over budget scored 73%.',
        )
      }
      if (goals.some(g => g.status === 'pending')) {
        items.push(
          'A target reading "Too early to call" is being measured, but no pass or fail is given until its period ends. Retention and churn can only be read as a share of a whole year, so early in the year they always look good — almost nobody has cancelled yet.',
        )
      }
      // Only explain the person rules when a person's target is actually on
      // screen — a company-only board should not be told about a scope it is
      // not using.
      const people = goals.filter(g => g.employee_id)
      if (people.length > 0) {
        items.push(
          "A person's figures come from the People report, so an individual's target cannot disagree with the report it is judged against.",
          `Only these can be set for one person: ${nameList(perPersonMetricLabels())}. Everything else cannot be split by person honestly — billing, payments, quotes and phone figures do not record who the work belongs to, and revenue per visit has no per-person visit count — so they are company-only.`,
          'A person is credited only with leads assigned to them, so individual targets will not add up to a company one — unassigned leads belong to nobody.',
        )
      }
      /* ⚠ Only when BOTH scopes of this one measure are on the board. Two labour
       * percentages under one name, one 27% and one 13%, read as a contradiction
       * unless the board says they are different questions. */
      if (people.some(g => g.metric === 'labor_pct') && goals.some(g => !g.employee_id && g.metric === 'labor_pct')) {
        items.push('The two labour cost targets here are different calculations, not the same one at two sizes: the company figure divides field pay by all completed work, a person\u2019s divides their own pay by the work credited to them.')
      }
      if (people.some(g => g.metric === 'labor_pct' && g.actual == null)) {
        items.push('A personal labour cost target reads "no data" for anyone with no completed work credited to them — a share of nothing is unmeasurable, not 0%.')
      }
      if (people.some(g => g.metric === 'close_rate' && g.actual == null)) {
        items.push('A close rate reads "no data" until that person has enough decided leads to rate fairly — the same floor the People report uses, rather than a rate built on two or three deals.')
      }
      if (r && r.total_in_window === 0) {
        items.unshift('No targets are set for this range yet. An admin adds them at the bottom of Admin → Reports.')
      } else if (goals.length === 0) {
        // ⚠ Distinct from the line above: targets exist, this card just is not showing
        // any. Saying "none are set" there would send an admin to fix the wrong thing.
        items.unshift(emptyBecause(scope, r))
      }
      return {
        kind: 'list',
        title: scopeTitle('How these are worked out', scope, goals),
        sub: r ? `As of ${r.as_of}` : win.phrase,
        items,
      }
    },
  },
]

/* ── Shared with the board-level narrator ───────────────────────────────────
 *
 * ⚠⚠ Exported rather than reimplemented, and that is the whole point: a sentence
 * saying "Mike is behind on work produced" sitting above a table that says "On
 * track" is the worst thing this feature could do. One scope filter, one status
 * word, one set of units — so the narrative cannot disagree with the card beside
 * it, because it is reading the same code.
 *
 * Renamed on the way out only because names like `scoped`, `fmt` and `whose` are
 * fine inside this file and useless in another.
 */
export {
  goalsReq as goalRequest,
  scoped as scopedGoals,
  GOAL_SCOPE_CONFIG,
  STATUS_TEXT as goalStatusText,
  STATUS_TONE as goalStatusTone,
  fmt as formatGoalValue,
  fmtTarget as formatGoalTarget,
  // ⚠ Shared so a sentence and the card it sits above cannot round the same money
  // two different ways — the whole reason the scope filter and status words are
  // shared from here too.
  moneyDecimals as goalMoneyDecimals,
  whose as goalOwner,
  scopePhrase as goalScopePhrase,
  emptyBecause as goalsEmptyBecause,
  periodCell as goalPeriodCell,
}
export type { GoalScope }

export const GOALS_REPORT_PRESET: { type: string; span: number }[] = [
  { type: 'kpi_goals_on_track', span: 3 },
  { type: 'kpi_goals_hit', span: 3 },
  { type: 'goals_table', span: 12 },
  { type: 'goals_progress', span: 6 },
  { type: 'goals_notes', span: 6 },
]
