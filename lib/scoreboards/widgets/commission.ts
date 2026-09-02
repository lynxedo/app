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
  CommissionPlanRow, CrewLaborRow, CrewPerson, LeadItemsRow, LeadItemUnit, PeopleRow, Person,
  ProductionPerson, ProductionRow, RevenueTrendRow,
} from './sources'
import type { SourceBag, SourceRequest, WidgetConfig, WidgetDef, WindowSpec } from './types'
import type { Tone, WidgetPayload } from './payloads'
import { formatCurrency } from '@/lib/format'
import { keepPerson, peopleField, peoplePhrase, personFilter, withPeopleTitle, type PersonFilter } from './people-filter'
import {
  type BasisUnit, type CommissionPlan, type CommissionBasis, type CommissionPeriod,
  type PeriodAmount, type RateKind, type TierMode, type VerifySource,
  PLAN_DEFAULTS, describeRule, formatBasisAmount, getBasis, normalizeTiers, payout,
  payoutOverPeriods, planCoversPeriod,
} from '@/lib/reports/commission'
import {
  type CommissionMonth, commissionMonth, commissionMonthLabel, encodeBuckets,
} from './windows'

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
/**
 * Revenue per labour hour and payroll-as-a-share, for the two Efficiency bases.
 *
 * ⚠⚠ THE SHAPE MATCHES `crew.ts`' OWN REQUEST EXACTLY — same source key, same two
 * params, nothing extra. That is what makes the resolver dedupe it: a commission card
 * on a board that already carries any Crew & Labor card costs ZERO extra round trips.
 * Adding a third param "for clarity" would silently double the query.
 *
 * ⚠ No new gate. These widgets are already Crew & Labor group, and `crew_labor` is the
 * source every card in that group reads — the wage figures behind it are exactly the
 * data this group exists to fence off, so nothing widens by reading it here.
 *
 * ⚠ This RPC CLAMPS its window to where timeclock and processed-payroll data exist. For
 * a RATIO that is safe — a rate measured over fewer days is still the right rate — and
 * it is the reason the Efficiency bases are ratios and not totals. The cards name the
 * days actually measured rather than the days asked for.
 */
const crewReq = (win: WindowSpec): SourceRequest =>
  ({ source: 'crew_labor', params: { start: win.start, end: win.end } })
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
 * Produced revenue and clocked hours, UNCLIPPED, plus the same per bonus week.
 *
 * ⚠⚠ THIS IS THE FIX FOR THE FIRST OF THE THREE BUGS. `crew_labor` above narrows its
 * window to where timeclock AND processed payroll both exist. For the labour-share
 * ratios that is right and it stays. For "revenue they produced" and "their revenue
 * per labour hour" it was a silent underpayment: on Heroes' August 2026 payroll
 * reached the 16th while the timeclock reached the month's end, so Josh's production
 * read $7,549 against the $12,140 he had produced and Lucas's rate read $62.01
 * against $73.99. The raw hours were sitting in `time_entries` the whole time.
 *
 * ⚠ Pure function of the window: the bonus weeks are derived from `win` alone, so the
 * resolver still dedupes this to ONE round trip per board however many commission
 * cards sit on it.
 */
const prodReq = (win: WindowSpec): SourceRequest => ({
  source: 'commission_production',
  params: { start: win.start, end: win.end, buckets: encodeBuckets(commissionMonth(win).weeks) },
})

/**
 * All six, always.
 *
 * ⚠ `sources()` must be a pure function of (cfg, window) — the resolver's dedupe key
 * depends on it — so it cannot look at the plans to decide which bases are actually in
 * use. Declaring all six is the cost of that purity; on a board that already carries
 * People, Crew & Labor, Service Line or Tracked Item cards, four of them are already
 * being fetched and cost nothing extra. Only `commission_production` is unique to
 * these cards, and it is one query per board however many of them there are.
 */
const ALL_SOURCES = (cfg: WidgetConfig, win: WindowSpec): SourceRequest[] =>
  [plansReq(), peopleReq(win), lineRevReq(win), itemsReq(cfg, win), crewReq(win), prodReq(win)]

/**
 * ⚠ This setting affects ONE basis — "particular things they sold" — and nothing
 * else. Its old label ("A product counts as sold when the stage is") read as though
 * it defined what a sale was for the whole card, which it never did; with upsells now
 * their own basis it also looked like the place upsells were defined, which it is
 * not. Both are set in Admin → Lead Tracker. Named for what it actually does.
 */
/** ⚠ `commission_plan_people`, not `staff_people` — see the header note. */
const PEOPLE_FIELD = { people: peopleField('commission_plan_people', 'people') }

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
    /* ⚠⚠ EVERY ONE OF THESE FALLS BACK TO TODAY'S BEHAVIOUR, not to the "new" option.
     * A row written before the migration, or read by a deploy that raced it, must pay
     * exactly what it paid yesterday — a pay feature that changes its mind because a
     * column was null is worse than one that lacks the feature. */
    period: (r.period as CommissionPeriod | null) ?? PLAN_DEFAULTS.period,
    tier_mode: (r.tier_mode as TierMode | null) ?? PLAN_DEFAULTS.tier_mode,
    verify_source: (r.verify_source as VerifySource | null) ?? null,
    min_price: r.min_price == null ? null : num(r.min_price),
    exclude_renewals: r.exclude_renewals === true,
    effective_from: r.effective_from ?? null,
    effective_to: r.effective_to ?? null,
  }
}

/* ── counting a verified unit ────────────────────────────────────────────────
 *
 * ⚠⚠ THIS IS THE FIX FOR THE THIRD BUG, AND IT IS WORTH SAYING WHAT THE BUG WAS. An
 * `item_count` rule counted Lead Tracker rows by service value and sold date and paid
 * a spiff for each. Two things that are not sales therefore paid:
 *
 *   a) Renewals. An irrigation Gold plan is ~$400 invoiced ANNUALLY and recurs on the
 *      anniversary. Eleven $400 Gold invoices were issued in Aug 2026 and nine of them
 *      were renewals for customers who already had the service. Only a NEW member is
 *      a sale, and nothing in the tracker row says which it is.
 *   b) Stale or misfiled rows. A "Kassy Brock · IR - Gold · $400" row dated 2026-08-11
 *      paid Lucas $30. Her real Gold was invoice 4406, issued 2026-04-23 and already
 *      paid to a different rep in April; the row was a mis-keyed backfill of another
 *      customer entirely. Nothing about the row looked wrong.
 *
 * A rule with `verify_source = 'invoice'` therefore counts a unit only when a real
 * invoice line in the period corroborates it, at or above `min_price`, and — with
 * `exclude_renewals` — only when the customer did not already have the thing.
 *
 * ⚠⚠ PRICE IS THE DISCRIMINATOR, NOT THE ITEM NAME, and this is the part that looks
 * wrong until you check. Under one Gold heading this book invoices: a $400 plan (the
 * sale), a $250.20 and a $205 part-year plan, a $100 single prepaid visit, and a $0
 * included member visit. The "- T1" suffix does NOT separate them — August's one real
 * sale, invoice 5847, is itself a "- T1" line at $400. So the floor is a price.
 *
 * ⚠ An unverified rule keeps the old counting EXACTLY. Mike Cyplik's "IR SVC" rule is
 * one, and his figures must not move.
 */

/** Why a unit did not count, in words a card can print. Null when it counted. */
export function unitRejection(plan: CommissionPlan, u: LeadItemUnit): string | null {
  if (plan.verify_source !== 'invoice') return null
  /* ⚠ Named rather than silently dropped. A tracker row whose customer name matches no
   * file can NEVER be corroborated, so paying zero for it would look like the rep sold
   * nothing when the real problem is a name that needs fixing. */
  if (!u.matched_client) return 'no customer file matches that name, so it cannot be checked against an invoice'
  const price = u.invoice_price == null ? null : num(u.invoice_price)
  if (price == null) return 'no invoice in this period backs it'
  if (plan.min_price != null && price < plan.min_price) {
    return `the matching invoice line is ${formatCurrency(price)}, under the ${formatCurrency(plan.min_price)} a sale has to be worth`
  }
  if (plan.exclude_renewals && u.prior_history) return 'that customer already had it — a renewal, not a new sale'
  return null
}

export type ItemTally = {
  counted: number
  /** Why each rejected unit did not count, most common first — for the card's note. */
  rejected: string[]
}

/**
 * How many units of this plan's items belong to this person.
 *
 * ⚠ Attribution is unchanged: the Lead Tracker's salesperson matched on FIRST NAME,
 * lowercased, exactly as `scoreboard_people` matches it. Only the DECISION about
 * whether a matched unit counts is new.
 */
export function tallyItems(plan: CommissionPlan, row: LeadItemsRow | null, personName: string): ItemTally {
  const wanted = new Set((plan.items ?? []).map(itemKey))
  const first = personName.split(' ')[0]?.toLowerCase() ?? ''
  const mine = (u: LeadItemUnit) => {
    const who = (u.salesperson ?? '').trim().split(' ')[0]?.toLowerCase() ?? ''
    return !!who && who === first
  }

  /* ⚠⚠ The UNVERIFIED path still reads `rows`, the pre-aggregated tally, rather than
   * counting `units`. Not laziness: `rows` counts DISTINCT leads per service value
   * while `units` is one entry per (lead × value), and a tracker row listing the same
   * service twice would count twice here and once there. Keeping the old path on the
   * old data is what guarantees no existing rule's figure moves. */
  if (plan.verify_source == null) {
    let n = 0
    for (const r of row?.rows ?? []) {
      if (!wanted.has(itemKey(r.value))) continue
      const who = (r.salesperson ?? '').trim().split(' ')[0]?.toLowerCase() ?? ''
      if (who && who === first) n += num(r.leads)
    }
    return { counted: n, rejected: [] }
  }

  let counted = 0
  const rejected: string[] = []
  // Deduped on (lead, value) so a row listing one service twice pays once.
  const seen = new Set<string>()
  for (const u of row?.units ?? []) {
    if (!wanted.has(itemKey(u.value))) continue
    if (!mine(u)) continue
    const key = `${u.lead_id}::${itemKey(u.value)}`
    if (seen.has(key)) continue
    seen.add(key)
    const why = unitRejection(plan, u)
    if (why) rejected.push(why)
    else counted += 1
  }
  return { counted, rejected }
}

export type EarnedLine = {
  plan: CommissionPlan
  person: string
  department: string | null
  /** The figure the rule was applied to. */
  amount: number
  /**
   * What kind of number that figure is — decides how the cell is formatted.
   * ⚠ Four units now, not two: a $/hour figure printed as plain dollars reads as a
   * trivial amount rather than a good rate.
   */
  unit: BasisUnit
  paid: number
  gross: number
  /** ⚠ Mirrors `Payout['limitedBy']`. `target` is a MISS, not a reduction — a target
   *  rule that fell short pays nothing rather than less. */
  limitedBy?: 'threshold' | 'cap' | 'target'
  /** Why this line pays nothing, when that is a configuration problem rather than a zero. */
  problem?: string
  /** Set on a per-bonus-week rule: what each week was worth and what it paid. */
  weeks?: { label: string; amount: number; paid: number }[]
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
  /** The person filter as applied, for titles, subtitles and the drill-down link. */
  filter: PersonFilter
  /** Rules dropped purely by the person filter — so an empty card can say it was filtered. */
  filteredOut: number
  /** Rule versions dated outside this period. */
  outOfForce: number
  /** The bonus weeks this window resolved to — for the table's own subtitle. */
  month: CommissionMonth
}

function assemble(bag: SourceBag, cfg: WidgetConfig, win: WindowSpec): Assembled {
  const plans = bag.get<CommissionPlanRow>(plansReq()).map(toPlan)
  const peopleRow = bag.get<PeopleRow>(peopleReq(win))[0] ?? null
  const trend = bag.get<RevenueTrendRow>(lineRevReq(win))[0] ?? null
  const itemsRow = bag.get<LeadItemsRow>(itemsReq(cfg, win))[0] ?? null
  const crewRow = bag.get<CrewLaborRow>(crewReq(win))[0] ?? null
  const prodRow = bag.get<ProductionRow>(prodReq(win))[0] ?? null
  /** The bonus weeks this window belongs to — one definition, shared with the RPC. */
  const cm = commissionMonth(win)

  const byEmployee = new Map<string, Person>()
  for (const p of peopleRow?.people ?? []) byEmployee.set(p.employee_id, p)
  /* ⚠ Keyed on `employee_id`, the same key a plan is keyed on — never on the name.
   * Crew & Labor composes names as "Angel Morin" while People Performance composes
   * them as "Angel", and matching on either would credit an efficiency figure to the
   * wrong person or to nobody. The id is the one thing both sources agree on. */
  const crewByEmployee = new Map<string, CrewPerson>()
  for (const c of crewRow?.people ?? []) crewByEmployee.set(c.employee_id, c)
  /* ⚠ Same key again — `employee_id`. The production source resolves its own Jobber
   * mapping with the identical matcher `crew_labor` uses, so the two agree about who
   * a visit belongs to; the id is what makes that checkable. */
  const prodByEmployee = new Map<string, ProductionPerson>()
  for (const pp of prodRow?.people ?? []) prodByEmployee.set(pp.employee_id, pp)

  // Line revenue, summed over the window from the unclamped trend.
  const lineRevenue = new Map<string, number>()
  for (const l of trend?.lines ?? []) {
    lineRevenue.set(l.k, (lineRevenue.get(l.k) ?? 0) + num(l.total))
  }

  const lines: EarnedLine[] = []
  const notes: string[] = []
  let inactive = 0
  let orphaned = 0
  const f = personFilter(cfg)
  let filteredOut = 0
  let usesUpsells = false
  /** Any PAYROLL-SHARE rule — decides whether the clamped-window note applies. ⚠ No
   *  longer set by revenue-per-hour: that basis reads the unclipped source now. */
  let usesEfficiency = false
  /** Any rule paid on the COMPANY's figure rather than this person's. */
  let usesCompanyWide = false
  const unattributable: string[] = []
  /* Who holds a rule paid on the combined figure, and who holds an upsell-only rule.
   * A person in BOTH sets is paid for their upsells twice. */
  const includesUpsells = new Set<string>()
  const upsellOnly = new Set<string>()
  /** Rules whose version is not in force for this period — see `planCoversPeriod`. */
  let outOfForce = 0
  /** Any rule measured over the bonus weeks, so the card can name the dates it used. */
  let usesBonusWeeks = false
  /** Every reason a verified unit was refused, for one honest note per card. */
  const unitRejections: string[] = []


  for (const plan of plans) {
    if (!plan.active) { inactive++; continue }
    const person = byEmployee.get(plan.employee_id)
    if (!person) { orphaned++; continue }
    /* ⚠ Applied HERE, in the pure metric, never pushed into a query — so a card for
     * Mike and an unfiltered card on the same board still share ONE round trip, and
     * the filter can only ever remove a rule the viewer was already sent. The fallback
     * is the person's own name because a commission row always has one. */
    if (!keepPerson(f, person.name, person.name)) { filteredOut++; continue }
    const def = getBasis(plan.basis)
    if (!def) continue
    /* ⚠⚠ THE VERSION GATE. A rule with an effective range that does not reach this
     * period is not shown as earning zero — it is not this period's rule at all.
     * Without this, editing a rate rewrote every month already paid: April 2026 paid a
     * flat $35 per upsell and became unreproducible the moment the rule became 5%. */
    if (!planCoversPeriod(plan, win.start, win.end)) { outOfForce++; continue }

    /* ── which sub-periods this rule is judged over ────────────────────────────
     *
     * ⚠⚠ ONLY THE TWO PRODUCTION BASES CAN BE MEASURED PER BONUS WEEK, because only
     * `commission_production` returns per-week buckets. Every other source is
     * window-scoped. A rule asking for weeks on a basis that has none is REFUSED with
     * a reason rather than quietly paid on the monthly figure — a weekly flat-tier
     * rule silently evaluated monthly is precisely the bug being fixed here, and
     * reintroducing it as a fallback would be worse than the original because the card
     * would claim to be weekly.
     */
    const bucketed = plan.basis === 'revenue_produced' || plan.basis === 'rev_per_hour'
    if (plan.period !== 'month' && !bucketed) {
      lines.push({
        plan, person: person.name, department: person.department,
        amount: 0, unit: def.unit, paid: 0, gross: 0,
        problem: `“${def.label}” has no weekly figure behind it, so this rule cannot be paid by bonus week — set it to the whole period, or pay it on revenue produced`,
      })
      continue
    }
    if (plan.period !== 'month') usesBonusWeeks = true

    let amount = 0
    let problem: string | undefined
    /** Set only on a per-week rule: the four weeks and what each was worth. */
    let parts: PeriodAmount[] | null = null

    switch (plan.basis) {
      /* ⚠ New business is derived by SUBTRACTION, not by a second query: `won` and
       * `sold_value` already carry Closed Won plus the upsells, and `upsold`/
       * `upsold_value` carry the upsell half. Taking the difference means the three
       * sales bases cannot disagree about what a deal was — the alternative, a
       * separate closed-won-only figure, is a second rule that can drift from the
       * Sales report next to it. Floored at zero: if a stage were ever ticked "Sold"
       * AND counted as a competed win, the difference could go negative, and a
       * negative basis is not a smaller bonus, it is a broken one.
       *
       * ⚠⚠ The `_closed` figures, counted by the date the deal was SOLD — not the
       * date its lead arrived. Ben: "we want close date not lead creation date." The
       * Sales report keeps the arrival cohort, because close rate is a question about
       * the leads that came in. */
      case 'new_sales_value':
        amount = Math.max(0, num(person.sales.sold_value_closed) - num(person.sales.upsold_value_closed))
        break
      case 'new_sales_count':
        amount = Math.max(0, num(person.sales.won_closed) - num(person.sales.upsold_closed))
        break
      case 'upsell_value':
        amount = num(person.sales.upsold_value_closed)
        usesUpsells = true
        upsellOnly.add(person.name)
        break
      case 'upsell_count':
        amount = num(person.sales.upsold_closed)
        usesUpsells = true
        upsellOnly.add(person.name)
        break
      case 'sales_value':
        amount = num(person.sales.sold_value_closed)
        includesUpsells.add(person.name)
        break
      case 'sales_count':
        amount = num(person.sales.won_closed)
        includesUpsells.add(person.name)
        break

      /* ── the two production bases, off the UNCLIPPED source ──────────────────
       *
       * ⚠⚠ READ FROM `commission_production`, NOT FROM `people`/`crew_labor`, AND
       * THAT IS THE FIRST BUG FIXED. Those two narrow their window to where processed
       * payroll exists, because they price hours from a real payroll. For a labour
       * SHARE that is right and they still serve it. For work produced it withheld pay
       * for days already worked: Josh's August read $7,549 against $12,140, and
       * Lucas's rate $62.01 against $73.99, purely because payroll stopped on the 16th.
       *
       * ⚠ This source also SPLITS a multi-tech visit evenly, where the technician
       * boards credit it whole to each. That removes the ~3.8% overpayment the old
       * warning on this card described, which is why the warning is gone.
       */
      case 'revenue_produced': {
        const pp = prodByEmployee.get(plan.employee_id)
        if (!pp) {
          problem = 'they are not on the roster this source can credit work to'
        } else if (!pp.attributable) {
          problem = 'no Jobber user matches them, so no completed work can be credited'
          unattributable.push(person.name)
        } else if (plan.period === 'week') {
          parts = cm.weeks.map(w => ({
            key: w.label,
            label: w.label,
            amount: num(pp.buckets.find(b => b.k === `W${w.n}`)?.revenue),
          }))
          // ⚠ The headline is the source's own span total, not the sum of the four
          // rounded weeks — the same reason `commission_weeks` reads it.
          amount = num(pp.weeks_revenue)
        } else if (plan.period === 'commission_weeks') {
          // ⚠ The source's own whole-span total, never the sum of four rounded weeks.
          amount = num(pp.weeks_revenue)
        } else {
          amount = num(pp.revenue)
        }
        break
      }
      case 'rev_per_hour': {
        const pp = prodByEmployee.get(plan.employee_id)
        if (!pp) {
          problem = 'they are not on the roster this source can credit work to'
        } else if (!pp.attributable) {
          problem = 'no Jobber user matches them, so no completed work can be credited'
          unattributable.push(person.name)
        } else if (plan.period === 'week') {
          /* ⚠ Each week's OWN rate, guarded per week. A week with no clocked hours has
           * no rate — it is not a rate of zero, which on a higher-is-better target
           * would simply miss, but it must not divide. */
          parts = cm.weeks.map(w => {
            const b = pp.buckets.find(x => x.k === `W${w.n}`)
            const hrs = num(b?.hours)
            return {
              key: w.label,
              label: w.label,
              amount: hrs > 0 ? num(b?.revenue) / hrs : 0,
            }
          })
          /* ⚠ The headline figure is the PERIOD rate, not the sum of four rates —
           * adding rates together is meaningless. Total revenue over total hours, both
           * taken unrounded over the whole span. */
          {
            const hrs = num(pp.weeks_hours)
            if (hrs <= 0) problem = 'they clocked no hours in these bonus weeks, so there is no revenue-per-hour figure'
            else amount = num(pp.weeks_revenue) / hrs
          }
        } else if (plan.period === 'commission_weeks') {
          /* ⚠⚠ ONE RATE OVER THE WHOLE FOUR WEEKS — total revenue divided by total
           * hours, never the average of four weekly rates. An unweighted mean of rates
           * over unequal hours is a different and wrong number, and both totals come
           * from the source's own unrounded span rather than added-up buckets. */
          const hrs = num(pp.weeks_hours)
          // ⚠⚠ GUARD THE DENOMINATOR. 0.02 stray hours once read $339,350/hr.
          if (hrs <= 0) problem = 'they clocked no hours in these bonus weeks, so there is no revenue-per-hour figure'
          else amount = num(pp.weeks_revenue) / hrs
        } else {
          const hrs = num(pp.hours)
          if (hrs <= 0) problem = 'they clocked no hours in this period, so there is no revenue-per-hour figure'
          else amount = num(pp.revenue) / hrs
        }
        break
      }

      case 'line_revenue':
        amount = lineRevenue.get(plan.line_prefix ?? '') ?? 0
        break

      /* ── the labour-share ratios, at both scopes ───────────────────────────
       *
       * ⚠⚠ THESE STILL READ `crew_labor`, ON PURPOSE. They are shares of real money
       * paid out, so they genuinely need a PROCESSED payroll — a labour percentage
       * computed from hours × rate would be an estimate presented as a wage bill. The
       * clamped window is therefore correct here and the coverage note still applies.
       *
       * ⚠⚠ EVERY BRANCH GUARDS ITS DENOMINATOR BEFORE IT DIVIDES, and on a
       * lower-is-better target that is the difference between a working feature and
       * one that pays every bonus for free: a person with no credited revenue divides
       * to 0%, and 0% is at or below any ceiling you can name.
       */
      case 'labor_pct': {
        usesEfficiency = true
        const cp = crewByEmployee.get(plan.employee_id)
        const rev = num(cp?.revenue)
        const cost = num(cp?.labor_cost)
        if (!cp) {
          problem = 'they have no row in the Crew & Labor figures for this period'
        } else if (!cp.attributable) {
          problem = 'no Jobber user matches them, so no completed work can be credited'
          unattributable.push(person.name)
        } else if (rev <= 0) {
          // ⚠⚠ THE GUARD THAT MATTERS. Divide by this and the answer is 0% — a perfect
          // score handed to somebody with no output at all.
          problem = 'no completed work is credited to them in this period, so their pay cannot be expressed as a share of it'
        } else if (cost <= 0) {
          // ⚠ 0% labour cost does not happen to somebody who worked. It means no
          // processed payroll reaches them — a gap, not an achievement.
          problem = 'no processed field payroll covers them in this period, so there is no percentage to measure'
        } else {
          amount = cost / rev * 100
        }
        break
      }
      case 'company_rev_per_hour': {
        usesEfficiency = true
        usesCompanyWide = true
        if (!crewRow?.coverage.has_data) {
          problem = 'no timeclock or payroll data covers this period, so the company figure cannot be worked out'
        } else if (crewRow.rev_per_hour == null || num(crewRow.hours) <= 0) {
          problem = 'the crew clocked no hours in this period, so there is no company revenue per hour'
        } else {
          amount = num(crewRow.rev_per_hour)
        }
        break
      }
      case 'company_labor_pct': {
        usesEfficiency = true
        usesCompanyWide = true
        if (!crewRow?.coverage.has_data) {
          problem = 'no timeclock or payroll data covers this period, so the company figure cannot be worked out'
        } else if (crewRow.labor_pct == null || num(crewRow.revenue) <= 0) {
          problem = 'no completed work is recorded in this period, so payroll cannot be expressed as a share of it'
        } else if (num(crewRow.labor_cost) <= 0) {
          problem = 'no processed field payroll covers this period yet, so there is no percentage to measure'
        } else {
          amount = num(crewRow.labor_pct)
        }
        break
      }

      case 'item_count': {
        /* ⚠⚠ THE THIRD BUG. An unverified rule counts tracker rows exactly as before;
         * a rule with `verify_source` requires a real invoice line behind each unit.
         * See `tallyItems` and `unitRejection` for what that catches and why price,
         * not the item name, is the discriminator. */
        const t = tallyItems(plan, itemsRow, person.name)
        amount = t.counted
        unitRejections.push(...t.rejected)
        break
      }
    }

    /* ⚠⚠ A PER-WEEK RULE IS PRICED WEEK BY WEEK AND THE RESULTS ADDED — never by
     * pricing the month's total once. That is the second bug: Josh's bands were being
     * applied to a whole month, so four ordinary weeks looked like one big one and
     * cleared bands nobody earned. See `payoutOverPeriods` for where the cap and the
     * threshold each belong. `parts` is only ever set on a basis that HAS weekly
     * figures, so this cannot silently pretend. */
    const out = problem
      ? { gross: 0, paid: 0 } as ReturnType<typeof payout>
      : parts
        ? payoutOverPeriods(plan, parts)
        : payout(plan, amount)
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
      /* What each bonus week contributed. Printed under the row, because "$34.36" on a
       * weekly rule is four decisions and the one question anybody has is which weeks
       * paid. */
      weeks: parts && !problem
        ? (out as ReturnType<typeof payoutOverPeriods>).parts?.map(x => ({
            label: x.label, amount: x.amount, paid: x.paid,
          }))
        : undefined,
    })
  }

  const total = lines.reduce((s, l) => s + l.paid, 0)

  /* ⚠⚠ THE OLD OVERPAYMENT WARNING IS GONE, AND ITS ABSENCE IS THE POINT. It said
   * produced-revenue rules "run a few percent above what the company produced",
   * because `people.field.revenue` credits a two-person visit whole to BOTH
   * technicians (measured: $16,331 of $429,475, 3.8%). `commission_production` splits
   * such a visit evenly, so the overpayment no longer exists and repeating the caveat
   * would now be describing the old arithmetic — the exact failure mode this file has
   * been caught by before. What replaces it is a statement of what IS true: how the
   * work is dated and how a shared visit is divided. */
  if (usesBonusWeeks) {
    notes.push(`bonus-week rules were measured over ${commissionMonthLabel(cm)} — W1 starts on the last Monday on or before the 1st`)
    /* ⚠⚠ THE GAP, SAID OUT LOUD. Four bonus weeks is 28 days, so a month whose anchor
     * falls early leaves days that W1–W4 cannot reach and that the NEXT month's W1
     * starts after — Aug 24–30 in 2026. Those days are in nobody's bonus period. This
     * is a property of the W1–W4 rule itself, not of the code, and it is named rather
     * than absorbed: a week's work quietly paying nothing is exactly the kind of thing
     * that goes unnoticed for a year. */
    if (cm.orphanedDays) {
      notes.push(`⚠ ${cm.orphanedDays.start} to ${cm.orphanedDays.end} fall outside W1–W4 and outside next month’s W1, so work done then is in no bonus week — four bonus weeks cover 28 days and this month is longer`)
    }
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
    notes.push(`${[...new Set(unattributable)].join(', ')} have no matching Jobber user, so no completed work can be credited to them`)
  }
  /* ⚠⚠ A company-wide rule is not a variant of a personal one, it is a different bet,
   * and on a payslip the two are indistinguishable. Said outright because the failure
   * mode is silent: a technician paid on the company's revenue per hour cannot move
   * their own bonus, and would spend a quarter trying. */
  if (usesCompanyWide) {
    notes.push('rules marked as the COMPANY’S figure ride on the whole crew’s number, not the individual’s — everyone holding one is paid on the same result')
  }
  /* ⚠⚠ The Efficiency bases come from Crew & Labor, which narrows its window to where
   * timeclock AND processed payroll both exist. For a ratio that is the correct thing
   * to do — a rate over fewer days is still the right rate — but a target compared
   * against a window nobody asked for has to say so, or a missed bonus looks arbitrary. */
  if (usesEfficiency) {
    const c = crewRow?.coverage
    if (!c?.has_data) {
      notes.push('no timeclock or payroll data covers this period, so no payroll-share target can be judged')
    } else {
      /* ⚠ REWORDED, because it no longer covers revenue per hour. That basis moved to
       * the unclipped production source, and leaving "revenue-per-hour" in this
       * sentence would tell the reader a figure had been narrowed when it had not —
       * a note describing the old rule is a wrong number in prose. */
      if (c.clamped && c.effective_start && c.effective_end) {
        notes.push(`payroll-share targets were judged on ${c.effective_start} to ${c.effective_end} only, because that is where timeclock and payroll data exist`)
      }
      /* The right edge, and it is the reason a target can flip after the fact: cost is
       * real money from a processed payroll, so clocked days past the last payroll are
       * held back rather than priced at hours x rate. */
      const tail = c.unpaid_tail_days ?? 0
      if (tail > 0) {
        notes.push(`the last ${tail} clocked day${tail === 1 ? '' : 's'} are not in these figures yet — no processed payroll reaches them, so a target can still move when the next payroll runs`)
      }
    }
  }
  /* ⚠⚠ THE OLD "produced-revenue rules cover X to Y only" NOTE IS DELETED, and this
   * is the visible half of the first fix. It fired off `people.coverage.clamped`, and
   * on Heroes' August it read "Aug 1 – Aug 16 (payroll through May 31, timeclock
   * after)" — an accurate description of a window that should never have been narrowed
   * in the first place. The production bases no longer read a clamped source, so there
   * is nothing to disclose. What IS worth saying is how the figure is built, since
   * both choices are defensible and neither is guessable from the card. */
  if (lines.some(l => l.plan.basis === 'revenue_produced' || l.plan.basis === 'rev_per_hour')) {
    notes.push('work produced is counted on the day it was scheduled, and a visit worked by two people is split evenly between them')
    /* ⚠ The right edge, and it is honest rather than clipping. Timeclock data can lag
     * the window's end by a day or two; saying so lets a figure be trusted without the
     * window silently shrinking underneath it. */
    const last = prodRow?.coverage.timeclock_last
    if (last && last < win.end) {
      notes.push(`hours are recorded through ${last}, so a rate covering days after that will still move`)
    }
  }
  /* ⚠ A verified spiff that refused units MUST say so. Silently counting fewer is how
   * the original bug hid in the opposite direction, and "0 units" next to a rule
   * called "Gold Sales" reads as a broken card rather than as a month with one real
   * sale in it. Grouped by reason and counted, because eleven identical lines are
   * noise and "9 were renewals" is a fact. */
  if (unitRejections.length) {
    const byReason = new Map<string, number>()
    for (const r of unitRejections) byReason.set(r, (byReason.get(r) ?? 0) + 1)
    const worst = [...byReason.entries()].sort((a, b) => b[1] - a[1])
    notes.push(`${unitRejections.length} tracked sale${unitRejections.length === 1 ? '' : 's'} did not count — ${worst.map(([r, n]) => `${n} because ${r}`).join('; ')}`)
  }
  if (outOfForce > 0) {
    notes.push(`${outOfForce} rule${outOfForce === 1 ? ' version is' : ' versions are'} dated outside this period, so ${outOfForce === 1 ? 'it does' : 'they do'} not apply to it`)
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

  /* ⚠ A filtered card discloses itself in the subtitle as well as the title: a tile
   * reading $1,462 is unremarkable for a company and very specific for one person,
   * and a glance is all a scoreboard gets. */
  const only = peoplePhrase(f)
  if (only) notes.unshift(only)

  return {
    lines, total, notes, inactive, orphaned, planCount: plans.length, filter: f, filteredOut,
    outOfForce, month: cm,
  }
}

/**
 * The link to the deals behind a commission figure.
 *
 * ⚠ Points at the Crew & Labor report because that is the grant these cards already
 * answer to — the drill-down route re-checks it, so the link cannot become a side
 * door for someone who can see the board but not the report.
 *
 * ⚠ The card's person filter is carried in the query string so the list narrows the
 * same way the card did. Names are comma-joined; a name containing a comma would
 * split, which is why the drill-down re-derives its own total and the page states
 * who it covers rather than trusting the caller.
 *
 * ⚠⚠ AND SO IS THE WINDOW, which it was not. Without `start`/`end` the detail page
 * falls back to the Crew & Labor report's DEFAULT range, so a card showing one month
 * opened a year-to-date list — Ben's report of this was "it has everything YTD".
 * That is precisely the failure this registry's opening note warns about: a list that
 * disagrees with the number above it makes a correct figure look broken. Every other
 * widget file has a `drillTo` helper doing exactly this; this one was written without
 * one and quietly lost the dates.
 */
function commissionDrill(a: Assembled, win: WindowSpec): { href: string; label: string } {
  const qs = new URLSearchParams({ start: win.start, end: win.end })
  if (a.filter.active) qs.set('people', a.filter.names.join(','))
  return {
    href: `/hub/reports/crew/commission-deals?${qs}`,
    label: 'See the deals behind these figures',
  }
}

/**
 * "$56.27/hr against a target of $100.00/hr" — why a target rule paid nothing.
 *
 * ⚠ A target bonus that misses pays exactly zero, and zero next to a rule called
 * "Efficiency bonus" reads as a broken card rather than as a miss. Both numbers are
 * printed so the row answers "by how much" without opening anything.
 *
 * ⚠ For a stepped rule the number quoted is the EASIEST band — the one they had to
 * clear to earn anything at all. Quoting the hardest would describe a bonus nobody was
 * chasing yet.
 */
function targetMiss(l: EarnedLine): string {
  const def = getBasis(l.plan.basis)
  const lower = def?.better === 'lower'
  let target: number | null = l.plan.threshold
  if (l.plan.rate_kind === 'target_tiered') {
    const tiers = normalizeTiers(l.plan.tiers)
    // `normalizeTiers` sorts ascending, so the easiest band is the LAST one when lower
    // is better (the loosest ceiling) and the FIRST when higher is better.
    target = (lower ? tiers[tiers.length - 1]?.from : tiers[0]?.from) ?? null
  }
  const figure = formatBasisAmount(def, l.amount)
  if (target == null) return `${figure} — no target set on this rule, so nothing can be paid`
  return `${figure} against ${lower ? 'a ceiling of' : 'a target of'} ${formatBasisAmount(def, target)} — nothing paid`
}

const NO_PLANS = 'No commission plans set up yet — an admin adds them in Admin → Reports.'
/* ⚠ A DIFFERENT message from NO_PLANS, and the distinction cost a real debugging
 * session: plans existed, every one was dropped, and the card said "none set up yet"
 * — pointing at the one screen where they demonstrably already were. An empty result
 * must say WHICH kind of empty it is. */
const PLANS_BUT_NOTHING = 'Commission plans exist, but none of them could be worked out for this period — see the notes above.'

/** The right empty-state line for what actually happened. */
function emptyLine(a: Assembled): string {
  /* ⚠ Three distinct empties, and conflating them is what cost a debugging session
   * once already: nothing set up · set up but nothing resolved · resolved but filtered
   * away. The last one is the easiest to cause by accident and the easiest to fix. */
  if (a.planCount === 0) return NO_PLANS
  if (a.filteredOut > 0 && a.lines.length === 0) {
    return `No rules for ${a.filter.names.join(', ') || 'the people picked'} — ${a.filteredOut} rule${a.filteredOut === 1 ? '' : 's'} for other people ${a.filteredOut === 1 ? 'was' : 'were'} filtered out in this card's ⚙ settings.`
  }
  return PLANS_BUT_NOTHING
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
    config: { ...PEOPLE_FIELD, stages: STAGES_FIELD },
    sources: ALL_SOURCES,
    metric: (bag, cfg, win) => {
      const a = assemble(bag, cfg, win)
      const people = new Set(a.lines.map(l => l.person)).size
      const problems = a.lines.filter(l => l.problem).length
      return {
        kind: 'kpi',
        label: withPeopleTitle('Commission Owed', a.filter),
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
          : [emptyLine(a), ...a.notes].join(' · '),
      }
    },
  },

  {
    type: 'commission_by_person',
    group: 'Crew & Labor',
    title: 'Commission Detail',
    blurb: 'One row per bonus rule: what it measures, the figure, and what it pays',
    defaultSpan: 12,
    config: { ...PEOPLE_FIELD, stages: STAGES_FIELD },
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
            /* ⚠ One column holding FOUR units. A count must not be rendered as dollars
             * — "$7.00" where the truth is "7 controllers" is a wrong number, not a
             * formatting quirk — and a $/hour figure rendered as plain dollars reads as
             * a trivial amount rather than a good rate. One shared formatter owns the
             * decision so the card, the editor and the rule sentence agree. */
            amount: formatBasisAmount(getBasis(l.plan.basis), l.amount),
            paid: l.paid,
          },
          tones: {
            paid: (l.problem ? 'bad' : l.paid > 0 ? 'good' : 'neutral') as Tone,
          } as Record<string, Tone>,
          /* ⚠⚠ ON A WEEKLY RULE THE WEEKS ARE PRINTED, and they are the whole answer
           * to the only question the row raises. "$34.36" against eight bands is four
           * separate decisions; without the breakdown the person being paid cannot
           * check it, and "under the threshold" would be said about a month where two
           * weeks did pay. The weekly line takes precedence over every generic
           * limitedBy message for exactly that reason. */
          meta: l.problem
            ? { text: l.problem, tone: 'bad' as Tone }
            : l.weeks?.length
              ? {
                  text: l.weeks
                    .map(w => `${w.label}: ${formatBasisAmount(getBasis(l.plan.basis), w.amount)} → ${w.paid > 0 ? formatCurrency(w.paid, { decimals: 2 }) : 'nothing'}`)
                    .join(' · ') + (l.limitedBy === 'cap' ? ` · capped from ${formatCurrency(l.gross)}` : ''),
                  tone: (l.paid > 0 ? 'neutral' : 'neutral') as Tone,
                }
              : l.limitedBy === 'cap'
                ? { text: `capped — the rule earned ${formatCurrency(l.gross)}`, tone: 'warn' as Tone }
                : l.limitedBy === 'threshold'
                  ? { text: 'under the threshold, so it pays nothing yet', tone: 'neutral' as Tone }
                  : l.limitedBy === 'target'
                    ? { text: targetMiss(l), tone: 'neutral' as Tone }
                    : undefined,
        }))
      return {
        kind: 'table',
        title: withPeopleTitle('Commission Detail', a.filter),
        sub: [
          `${win.phrase} · ${formatCurrency(a.total)} in total`,
          /* ⚠⚠ CONDITIONAL NOW, and that is the fourth fix showing through. This line
           * used to read "rules are not dated, so changing a rate changes what earlier
           * periods show" unconditionally — a true and unfixable-sounding warning. A
           * rule can now carry an effective range, so the warning is only shown for
           * the rules on THIS card that still lack one, and it says what to do. */
          ...(a.lines.some(l => !l.plan.effective_from && !l.plan.effective_to)
            ? ['some rules carry no start date, so changing their rate also changes what earlier periods show — set “in force from” to freeze a month once it is paid']
            : []),
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
        /* ⚠⚠ The filter travels in the href. A drill-down must reproduce its card's
         * filter exactly — a list disagreeing with the number above it makes a correct
         * figure look broken. Only offered when there is something to open. */
        drill: a.lines.length ? commissionDrill(a, win) : undefined,
        empty: emptyLine(a),
      }
    },
  },

  {
    type: 'commission_by_person_bars',
    group: 'Crew & Labor',
    title: 'Commission by Person',
    blurb: 'Who earned what, totalled across all of their rules',
    defaultSpan: 6,
    config: { ...PEOPLE_FIELD, stages: STAGES_FIELD },
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
        title: withPeopleTitle('Commission by Person', a.filter),
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
        empty: emptyLine(a),
      }
    },
  },
]
