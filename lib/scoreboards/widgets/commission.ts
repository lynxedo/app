/* Commission — what each person is owed this period, against their own bonus rules.
 *
 * Ben's brief: "every technician has a different bonus program. some are based on
 * sales some on revenue brought in some based on revenue brought in by the department.
 * some are based on selling particular things. Unsure if you could open it up that
 * much or I would have to tell you what each technician's criteria is."
 *
 * It opens up that far, and the honest answer to the second half is: the RULES are not
 * derivable from anything in the product, so each person's plan is typed in once in
 * Admin → Reports. What the rules are measured AGAINST already exists — which is why
 * there is no new database function here. Every basis comes from a source the library
 * already has, and the arithmetic is a pure metric.
 *
 * ⚠⚠ ATTRIBUTION IS INHERITED, NOT RE-DERIVED. A plan is keyed on `employees.id`, and
 * the per-person figures come from `scoreboard_people`, which already reconciles the
 * roster against `leads.salesperson` and against the Jobber crew. Re-matching people
 * here would create a second rule that can drift from the People card next to it —
 * and the two disagreeing about what somebody sold is the worst possible bug in a
 * feature about pay.
 *
 * ⚠ NO PERSON FILTER on these cards, deliberately. The filter plumbing matches on
 * NAME, and the `staff_people` catalog offers names as Crew & Labor composes them
 * ("Angel Morin") while this source composes them as People Performance does
 * ("Angel") — a picker built on the wrong one matches nothing and renders an honest-
 * looking zero. The list is short by construction anyway: only people who have a plan
 * appear at all.
 */

import type {
  CommissionPlanRow, LeadItemsRow, PeopleRow, Person, RevenueTrendRow,
} from './sources'
import type { SourceBag, SourceRequest, WidgetConfig, WidgetDef, WindowSpec } from './types'
import type { Tone, WidgetPayload } from './payloads'
import { formatCurrency } from '@/lib/format'
import {
  type CommissionPlan, type CommissionBasis, type RateKind,
  describeRule, getBasis, normalizeTiers, payout,
} from '@/lib/reports/commission'

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const asArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : []

/** Same fold the tracked-item cards use, so "IR- Rachio" and "IR - Rachio" agree. */
function itemKey(raw: string): string {
  return raw.toLowerCase().replace(/\s*[-–—/]\s*/g, '-').replace(/\s+/g, ' ').trim()
}


/* ── sources ─────────────────────────────────────────────────────────────── */

const plansReq = (): SourceRequest => ({ source: 'commission_plans', params: {} })
/**
 * ⚠⚠ `commission_people`, NOT `people`. Same RPC, but `people` narrows to the
 * viewer's own row unless the caller holds the People team-view grant — and the
 * custom scoreboard route hardcodes that false, because a board carries no
 * per-report grant. Reading `people` here meant every plan belonging to anyone but
 * the viewer was dropped as orphaned and the cards showed $0 on a custom board,
 * which is the only place these cards can be placed. See the source's own note for
 * why the unnarrowed read is safe: these widgets are Crew-&-Labor-gated, and a
 * restricted widget is dropped before the resolver ever runs.
 */
const peopleReq = (win: WindowSpec): SourceRequest =>
  ({ source: 'commission_people', params: { start: win.start, end: win.end } })
/**
 * Service-line revenue for the `line_revenue` basis.
 *
 * ⚠⚠ From `visit_revenue_trend`, NOT `service_lines`. Both report revenue per line and
 * they disagree on purpose: `service_lines` CLAMPS its window to where timeclock data
 * exists, because it divides revenue by labour hours. Paying a percentage on a clamped
 * figure would silently UNDERPAY whenever the board's range starts before timeclock
 * coverage — the window would shrink without the number saying so. This source is
 * deliberately unclamped.
 */
const lineRevReq = (win: WindowSpec): SourceRequest => ({
  source: 'visit_revenue_trend',
  params: { start: win.start, end: win.end, grain: 'month', tech_credit: 'each' },
})
const itemsReq = (cfg: WidgetConfig, win: WindowSpec): SourceRequest => ({
  source: 'lead_items',
  params: {
    start: win.start,
    end: win.end,
    basis: 'sold',
    stages: [...asArray(cfg.stages)].sort().join(','),
  },
})

/**
 * All four, always.
 *
 * ⚠ `sources()` must be a pure function of (cfg, window) — the resolver's dedupe key
 * depends on it — so it cannot look at the plans to decide which bases are actually in
 * use. Declaring all four is the cost of that purity; on a board that already carries
 * People, Service Line or Tracked Item cards, three of them are already being fetched
 * and cost nothing extra.
 */
const ALL_SOURCES = (cfg: WidgetConfig, win: WindowSpec): SourceRequest[] =>
  [plansReq(), peopleReq(win), lineRevReq(win), itemsReq(cfg, win)]

/**
 * ⚠ This setting affects ONE basis — "particular things they sold" — and nothing
 * else. Its old label ("A product counts as sold when the stage is") read as though
 * it defined what a sale was for the whole card, which it never did; with upsells now
 * their own basis it also looked like the place upsells were defined, which it is
 * not. Both are set in Admin → Lead Tracker. Named for what it actually does.
 */
const STAGES_FIELD = {
  kind: 'catalog' as const,
  label: 'Stages counted by “particular things they sold” rules',
  def: ['closed_won'],
  catalog: 'tracker_stages' as const,
  hint: 'Only affects rules paid on particular things sold — leave it alone otherwise. It does NOT set what counts as a sale or an upsell; those come from the “Sold” ticks in Admin → Lead Tracker.',
}


/* ── assembling one person's commission ──────────────────────────────────── */

function toPlan(r: CommissionPlanRow): CommissionPlan {
  return {
    id: r.id,
    employee_id: r.employee_id,
    label: r.label,
    basis: r.basis as CommissionBasis,
    rate_kind: r.rate_kind as RateKind,
    rate: r.rate == null ? null : num(r.rate),
    tiers: r.tiers == null ? null : normalizeTiers(r.tiers),
    threshold: r.threshold == null ? null : num(r.threshold),
    cap: r.cap == null ? null : num(r.cap),
    line_prefix: r.line_prefix,
    items: r.items,
    active: r.active,
    sort_order: r.sort_order,
  }
}

export type EarnedLine = {
  plan: CommissionPlan
  person: string
  department: string | null
  /** The figure the rule was applied to. */
  amount: number
  /** Whether that figure is money or a tally — decides how a cell is formatted. */
  unit: 'currency' | 'count'
  paid: number
  gross: number
  limitedBy?: 'threshold' | 'cap'
  /** Why this line pays nothing, when that is a configuration problem rather than a zero. */
  problem?: string
}

type Assembled = {
  lines: EarnedLine[]
  total: number
  /** Caveats that belong on the card rather than in a doc nobody opens. */
  notes: string[]
  /** Plans switched off, and plans whose person has no figures this period. */
  inactive: number
  orphaned: number
  /** How many rules exist at all — distinguishes "none set up" from "none resolved". */
  planCount: number
}

function assemble(bag: SourceBag, cfg: WidgetConfig, win: WindowSpec): Assembled {
  const plans = bag.get<CommissionPlanRow>(plansReq()).map(toPlan)
  const peopleRow = bag.get<PeopleRow>(peopleReq(win))[0] ?? null
  const trend = bag.get<RevenueTrendRow>(lineRevReq(win))[0] ?? null
  const itemsRow = bag.get<LeadItemsRow>(itemsReq(cfg, win))[0] ?? null

  const byEmployee = new Map<string, Person>()
  for (const p of peopleRow?.people ?? []) byEmployee.set(p.employee_id, p)

  // Line revenue, summed over the window from the unclamped trend.
  const lineRevenue = new Map<string, number>()
  for (const l of trend?.lines ?? []) {
    lineRevenue.set(l.k, (lineRevenue.get(l.k) ?? 0) + num(l.total))
  }

  const lines: EarnedLine[] = []
  const notes: string[] = []
  let inactive = 0
  let orphaned = 0
  let sharedVisitRisk = false
  let usesUpsells = false
  const unattributable: string[] = []
  /* Who holds a rule paid on the combined figure, and who holds an upsell-only rule.
   * A person in BOTH sets is paid for their upsells twice. */
  const includesUpsells = new Set<string>()
  const upsellOnly = new Set<string>()

  for (const plan of plans) {
    if (!plan.active) { inactive++; continue }
    const person = byEmployee.get(plan.employee_id)
    if (!person) { orphaned++; continue }
    const def = getBasis(plan.basis)
    if (!def) continue

    let amount = 0
    let problem: string | undefined

    switch (plan.basis) {
      /* ⚠ New business is derived by SUBTRACTION, not by a second query: `won` and
       * `sold_value` already carry Closed Won plus the upsells, and `upsold`/
       * `upsold_value` carry the upsell half. Taking the difference means the three
       * sales bases cannot disagree about what a deal was — the alternative, a
       * separate closed-won-only figure, is a second rule that can drift from the
       * Sales report next to it. Floored at zero: if a stage were ever ticked "Sold"
       * AND counted as a competed win, the difference could go negative, and a
       * negative basis is not a smaller bonus, it is a broken one. */
      case 'new_sales_value':
        amount = Math.max(0, num(person.sales.sold_value) - num(person.sales.upsold_value))
        break
      case 'new_sales_count':
        amount = Math.max(0, num(person.sales.won) - num(person.sales.upsold))
        break
      case 'upsell_value':
        amount = num(person.sales.upsold_value)
        usesUpsells = true
        upsellOnly.add(person.name)
        break
      case 'upsell_count':
        amount = num(person.sales.upsold)
        usesUpsells = true
        upsellOnly.add(person.name)
        break
      case 'sales_value':
        amount = num(person.sales.sold_value)
        includesUpsells.add(person.name)
        break
      case 'sales_count':
        amount = num(person.sales.won)
        includesUpsells.add(person.name)
        break
      case 'revenue_produced':
        amount = num(person.field.revenue)
        sharedVisitRisk = true
        /* ⚠ `attributable` is false when nobody in Jobber matches this person, so no
         * completed work can ever be credited to them. Their revenue reads 0 and a
         * percentage of 0 is 0 — a plausible number that is actually a broken link.
         * Named rather than paid as zero. */
        if (!person.field.attributable) {
          problem = 'no Jobber user matches them, so no completed work can be credited'
          unattributable.push(person.name)
        }
        break
      case 'line_revenue':
        amount = lineRevenue.get(plan.line_prefix ?? '') ?? 0
        break
      case 'item_count': {
        const wanted = new Set((plan.items ?? []).map(itemKey))
        // Their name as the Lead Tracker spells it — matched the way scoreboard_people
        // matched it, on the first name, lowercased.
        const first = person.name.split(' ')[0]?.toLowerCase() ?? ''
        for (const r of itemsRow?.rows ?? []) {
          if (!wanted.has(itemKey(r.value))) continue
          const who = (r.salesperson ?? '').trim().split(' ')[0]?.toLowerCase() ?? ''
          if (who && who === first) amount += num(r.leads)
        }
        break
      }
    }

    const out = payout(plan, amount)
    lines.push({
      plan,
      person: person.name,
      department: person.department,
      amount,
      unit: def.unit,
      paid: problem ? 0 : out.paid,
      gross: out.gross,
      limitedBy: out.limitedBy,
      problem: problem ?? out.problem,
    })
  }

  const total = lines.reduce((s, l) => s + l.paid, 0)

  /* ⚠⚠ The overpayment warning. `field.revenue` credits a two-person visit's full
   * value to BOTH technicians — that is how every technician board reports it — so a
   * straight percentage of it pays on about 3.8% more revenue than the company
   * produced ($16,331 of $429,475 on Heroes' 2026 book). Only said when a rule
   * actually uses that basis, because a caveat that does not apply to this card reads
   * as though it had been measured for it. */
  if (sharedVisitRisk) {
    notes.push('rules paid on “revenue they produced” ride on a figure that credits a two-person visit to both people, so it runs a few percent above what the company produced')
  }
  /* ⚠⚠ THE DOUBLE-PAY WARNING, and it is the reason the combined basis kept its old
   * meaning rather than being quietly redefined. "Value they sold" already contains
   * the upsells, so a person holding that AND an upsell rule is paid for every upsell
   * twice — a real overpayment that looks like an ordinary bigger number. Named per
   * person, because the fix is to switch one of THEIR rules to new-business-only. */
  const doublePaid = [...includesUpsells].filter(n => upsellOnly.has(n))
  if (doublePaid.length) {
    notes.push(`${doublePaid.join(', ')} ${doublePaid.length === 1 ? 'has' : 'have'} both an upsell rule and a rule paid on new business and upsells together, so their upsells are paid twice — switch one to “new business only”`)
  }
  /* An upsell rule against a Lead Tracker where no stage is ticked "Sold" can only
   * ever pay zero. A plausible-looking $0 reads as "they sold nothing", not as "this
   * is switched off", so it is said outright. */
  if (usesUpsells && !(peopleRow?.sale_stages?.length)) {
    notes.push('no Lead Tracker stage is ticked as “Sold”, so every upsell rule pays nothing until one is — Admin → Lead Tracker')
  }
  if (unattributable.length) {
    notes.push(`${[...new Set(unattributable)].join(', ')} have no matching Jobber user, so no produced revenue can be credited to them`)
  }
  /* ⚠ People's revenue comes from the timeclock-clamped crew source. If the window
   * got clamped, the commission was computed over a SHORTER period than the one on
   * screen — which would underpay without saying so. */
  const cov = peopleRow?.coverage
  if (cov?.clamped && cov.effective_start && cov.effective_end) {
    notes.push(`produced-revenue rules cover ${cov.effective_start} to ${cov.effective_end} only, because that is where timeclock data exists`)
  }
  /* ⚠ Worded for what was actually checked. The old text said "no longer on the
   * roster", which was simply false in the case that made it appear — the person was
   * on the roster; the figures had been narrowed out from under the card. Say what is
   * true: they have no row in this period's figures, and give both real reasons. */
  if (orphaned > 0) {
    notes.push(`${orphaned} rule${orphaned === 1 ? ' is' : 's are'} for someone with no figures in this period — they have either left or had no activity in this window`)
  }
  if (inactive > 0) {
    notes.push(`${inactive} rule${inactive === 1 ? ' is' : 's are'} switched off`)
  }

  return { lines, total, notes, inactive, orphaned, planCount: plans.length }
}

const NO_PLANS = 'No commission plans set up yet — an admin adds them in Admin → Reports.'
/* ⚠ A DIFFERENT message from NO_PLANS, and the distinction cost a real debugging
 * session: plans existed, every one was dropped, and the card said "none set up yet"
 * — pointing at the one screen where they demonstrably already were. An empty result
 * must say WHICH kind of empty it is. */
const PLANS_BUT_NOTHING = 'Commission plans exist, but none of them could be worked out for this period — see the notes above.'

/** The right empty-state line for what actually happened. */
function emptyLine(planCount: number): string {
  return planCount === 0 ? NO_PLANS : PLANS_BUT_NOTHING
}


/* ── the widgets ─────────────────────────────────────────────────────────── */

export const COMMISSION_WIDGETS: WidgetDef<WidgetPayload>[] = [
  {
    type: 'kpi_commission_total',
    /**
     * ⚠ Crew & Labor, and this is the security decision rather than a filing choice.
     * Commission is PAY. Crew & Labor is the report that already carries wage-shaped
     * data and is gated for exactly that reason, so these cards inherit a gate that
     * already exists and matches their sensitivity — no new grant, no widening.
     *
     * Deliberately NOT People Performance: that report is the one anyone with Hub
     * access can open, because it is how a person sees their own numbers, and Ben's
     * rule for it is "no pay, no coaching grades". Putting commission there would
     * break that rule for everybody at once. A technician seeing their OWN commission
     * is a reasonable thing to want and a separate decision — it needs a self-scoped
     * source like §8.7's, not a filed-differently card.
     */
    group: 'Crew & Labor',
    title: 'Commission Owed',
    blurb: 'Total commission earned this period across everyone with a plan',
    defaultSpan: 3,
    config: { stages: STAGES_FIELD },
    sources: ALL_SOURCES,
    metric: (bag, cfg, win) => {
      const a = assemble(bag, cfg, win)
      const people = new Set(a.lines.map(l => l.person)).size
      const problems = a.lines.filter(l => l.problem).length
      return {
        kind: 'kpi',
        label: 'Commission Owed',
        value: a.lines.length ? formatCurrency(a.total) : '—',
        tone: 'warn',
        /* ⚠ The notes are printed when the card is EMPTY too. They were previously
         * dropped in that branch, so the one situation where the card most needed to
         * explain itself — nothing resolved — was the one where it explained least,
         * and it fell back to "none set up yet" while rules plainly existed. */
        sub: a.lines.length
          ? [
              `${win.phrase} · ${a.lines.length} rule${a.lines.length === 1 ? '' : 's'} across ${people} ${people === 1 ? 'person' : 'people'}`,
              ...(problems ? [`${problems} cannot be worked out — see the table`] : []),
              ...a.notes,
            ].join(' · ')
          : [emptyLine(a.planCount), ...a.notes].join(' · '),
      }
    },
  },

  {
    type: 'commission_by_person',
    group: 'Crew & Labor',
    title: 'Commission Detail',
    blurb: 'One row per bonus rule: what it measures, the figure, and what it pays',
    defaultSpan: 12,
    config: { stages: STAGES_FIELD },
    sources: ALL_SOURCES,
    metric: (bag, cfg, win) => {
      const a = assemble(bag, cfg, win)
      const rows = a.lines
        .sort((x, y) => y.paid - x.paid || x.person.localeCompare(y.person))
        .map(l => ({
          key: l.plan.id,
          cells: {
            person: l.person,
            rule: l.plan.label,
            measures: describeRule(l.plan),
            // ⚠ One column holding two units. A count basis must not be rendered as
            // dollars — "$7.00" where the truth is "7 controllers" is a wrong number,
            // not a formatting quirk — so the cell is pre-formatted text.
            amount: l.unit === 'currency'
              ? formatCurrency(l.amount)
              : l.amount.toLocaleString('en-US'),
            paid: l.paid,
          },
          tones: {
            paid: (l.problem ? 'bad' : l.paid > 0 ? 'good' : 'neutral') as Tone,
          } as Record<string, Tone>,
          meta: l.problem
            ? { text: l.problem, tone: 'bad' as Tone }
            : l.limitedBy === 'cap'
              ? { text: `capped — the rule earned ${formatCurrency(l.gross)}`, tone: 'warn' as Tone }
              : l.limitedBy === 'threshold'
                ? { text: 'under the threshold, so it pays nothing yet', tone: 'neutral' as Tone }
                : undefined,
        }))
      return {
        kind: 'table',
        title: 'Commission Detail',
        sub: [
          `${win.phrase} · ${formatCurrency(a.total)} in total`,
          // ⚠ Rates are not dated. Editing one changes what past periods report, the
          // same way the crew costing applies today's wage to an old week. Said here
          // rather than discovered when a closed period moves.
          'rules are not dated, so changing a rate changes what earlier periods show',
          ...a.notes,
        ].join(' · '),
        columns: [
          { key: 'person', label: 'Person', align: 'left', sortable: true },
          { key: 'rule', label: 'Rule', align: 'left' },
          { key: 'measures', label: 'How it pays', align: 'left' },
          { key: 'amount', label: 'Figure it rides on', align: 'right' },
          { key: 'paid', label: 'Earned', align: 'right', format: 'currency', sortable: true },
        ],
        rows,
        foot: a.lines.length ? `${formatCurrency(a.total)} owed for ${win.label}` : undefined,
        empty: emptyLine(a.planCount),
      }
    },
  },

  {
    type: 'commission_by_person_bars',
    group: 'Crew & Labor',
    title: 'Commission by Person',
    blurb: 'Who earned what, totalled across all of their rules',
    defaultSpan: 6,
    config: { stages: STAGES_FIELD },
    sources: ALL_SOURCES,
    metric: (bag, cfg, win) => {
      const a = assemble(bag, cfg, win)
      const byPerson = new Map<string, { paid: number; rules: number }>()
      for (const l of a.lines) {
        const g = byPerson.get(l.person) ?? { paid: 0, rules: 0 }
        g.paid += l.paid
        g.rules += 1
        byPerson.set(l.person, g)
      }
      return {
        kind: 'bars',
        title: 'Commission by Person',
        sub: [`${win.phrase} · ${formatCurrency(a.total)} in total`, ...a.notes].join(' · '),
        format: 'currency',
        rows: [...byPerson.entries()]
          .sort((x, y) => y[1].paid - x[1].paid || x[0].localeCompare(y[0]))
          .map(([name, g]) => ({
            label: name,
            value: Math.round(g.paid * 100) / 100,
            tone: 'good' as Tone,
            detail: `${g.rules} rule${g.rules === 1 ? '' : 's'}`,
          })),
        empty: emptyLine(a.planCount),
      }
    },
  },
]
