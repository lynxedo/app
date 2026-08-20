import { formatCurrency } from '@/lib/format'

/* Commission plans — what a bonus rule is, and how it pays.
 *
 * Shared by the admin editor (Admin → Reports) and the commission widgets, so the
 * rule you type and the figure you read can never disagree about the arithmetic.
 * Pure: no I/O, no clock reads.
 *
 * Ben's brief was that every technician's bonus program is different — "some are
 * based on sales, some on revenue brought in, some on revenue brought in by the
 * department, some based on selling particular things" — and asked whether it could
 * be opened up that far. It can, on one condition: the RULES are not derivable from
 * anything in the product, so each person's plan is typed in once. What the rules
 * are measured AGAINST already exists.
 *
 * ⚠ A person may hold several plans. That is how "5% of irrigation sales PLUS $50 a
 * controller" is expressed, rather than inventing a compound rule type.
 */

/** What a bonus rides on. Every one of these is already computed somewhere. */
export type CommissionBasis =
  | 'new_sales_value'
  | 'new_sales_count'
  | 'upsell_value'
  | 'upsell_count'
  | 'sales_value'
  | 'sales_count'
  | 'revenue_produced'
  | 'line_revenue'
  | 'item_count'
  | 'rev_per_hour'
  | 'company_rev_per_hour'
  | 'labor_pct'
  | 'company_labor_pct'

export type RateKind = 'percent' | 'per_unit' | 'tiered' | 'target_flat' | 'target_tiered'

/**
 * What kind of number the basis IS — which decides what can honestly be done to it.
 *
 * ⚠⚠ `money_per_hour` and `percent` are RATIOS, and a ratio cannot take a rate. 5% of
 * "$91.84 per labour hour" is $4.59, which is not a small bonus, it is a category
 * error — the figure is a speed, not an amount, and a share of a speed means nothing.
 * Ratios are paid by hitting a TARGET instead; see `rateKindsFor`.
 */
export type BasisUnit = 'currency' | 'count' | 'money_per_hour' | 'percent'

/** The units paid by hitting a target rather than by a rate applied to them. */
export const RATIO_UNITS = new Set<BasisUnit>(['money_per_hour', 'percent'])

/** Heading the editor files this basis under. Thirteen options in one flat list is a wall. */
export type BasisGroup = 'Sales' | 'Work done' | 'Efficiency' | 'Products'

export type CommissionBasisDef = {
  key: CommissionBasis
  label: string
  group: BasisGroup
  /** Short phrase for a one-line rule summary — the full label reads badly mid-sentence. */
  noun: string
  unit: BasisUnit
  /** One line in the editor: what it measures, and what to watch. */
  hint: string
  /** An extra field this basis cannot work without. */
  needs?: 'line' | 'items'
  /**
   * Which direction is good, on a ratio basis. Revenue per hour is meant to go UP;
   * payroll as a share of revenue is meant to come DOWN, so its target is a CEILING
   * and not a floor.
   *
   * ⚠⚠ Declared here and nowhere else. The editor's wording, `payout()`'s comparison
   * and `describeRule()`'s sentence all read this one field, so a target can never be
   * described one way and paid the other — and getting the labour percentage backwards
   * would pay every bonus in the company's worst month and none in its best.
   */
  better?: 'higher' | 'lower'
  /**
   * True when the figure is the COMPANY's, not this person's. Said on the card and in
   * the editor, because two rules can read identically on a payslip and mean entirely
   * different things — one is what they did, the other is what everybody did.
   */
  companyWide?: boolean
  /** Shown as a warning in the editor — a real caveat about paying on this figure. */
  caution?: string
}

/**
 * ⚠⚠ THE THREE SALES BASES OVERLAP ON PURPOSE, AND THE OVERLAP IS THE WHOLE POINT.
 *
 * Ben: "the lead tracker we use Closed Won but there is also an Upsell section. I give
 * a bonus on upsells but it is different then regular sales." A won deal is therefore
 * one of two kinds, and a rule needs to be able to name either kind — or both.
 *
 *   new_sales_value  Closed Won only          — a deal competed for and won
 *   upsell_value     the "Sold" stages only   — sold to a customer already on the book
 *   sales_value      both                     — what the original single basis meant
 *
 * ⚠⚠ ALL SIX SALES BASES COUNT A DEAL IN THE PERIOD IT WAS SOLD, not the period its
 * lead arrived. Ben, asked directly: "we want close date not lead creation date." The
 * Sales report deliberately keeps the arrival cohort — close rate is a question about
 * the leads that came in — so `scoreboard_people` carries both, and these read the
 * `_closed` figures. Two consequences worth knowing: a deal that arrived in one month
 * and closed in the next is paid in the month it closed (on Heroes' real August that
 * was $3,660 of basis), and the value bases now agree with `item_count`, which has
 * always counted by sold date and was quietly the odd one out.
 *
 * `sales_value` is KEPT rather than redefined to mean new business. Redefining it would
 * silently change what an existing rule pays without anybody editing it, which in a pay
 * feature is the worst possible way to be right. Its caution says what it covers, and
 * the Commission cards warn when a person holds one of these AND an upsell rule, since
 * that pays the same upsell twice.
 */
export const COMMISSION_BASES: CommissionBasisDef[] = [
  {
    key: 'new_sales_value',
    label: 'Value they sold — new business only',
    group: 'Sales',
    noun: 'new-business value sold',
    unit: 'currency',
    hint: 'Annual value of the deals they moved to Closed Won, counted in the period they were SOLD. Upsells are not counted — they have their own basis, so an upsell can pay a different rate.',
  },
  {
    key: 'new_sales_count',
    label: 'Number of new-business sales they closed',
    group: 'Sales',
    noun: 'new-business sales',
    unit: 'count',
    hint: 'How many deals they moved to Closed Won, counted in the period they were sold, rather than what those deals were worth. Upsells are not counted.',
  },
  {
    key: 'upsell_value',
    label: 'Value of upsells they sold',
    group: 'Sales',
    noun: 'upsell value sold',
    unit: 'currency',
    /* ⚠ "Upsell" is not hardcoded to a stage named Upsells. It is every stage ticked
     * "Sold" in Admin → Lead Tracker, which is the flag that exists precisely so a
     * tenant can say which of their own stages are sales-but-not-competed-wins. */
    hint: 'Annual value of the deals in the stages you ticked as “Sold” in Admin → Lead Tracker — the Upsells section — rather than Closed Won, counted in the period they were sold.',
    caution: 'If no stage is ticked as “Sold”, this basis has nothing to count and every rule using it pays zero.',
  },
  {
    key: 'upsell_count',
    label: 'Number of upsells they sold',
    group: 'Sales',
    noun: 'upsells sold',
    unit: 'count',
    hint: 'How many upsells they closed in the period — for a flat spiff per upsell rather than a percentage of its value.',
    caution: 'If no stage is ticked as “Sold” in Admin → Lead Tracker, this basis has nothing to count and every rule using it pays zero.',
  },
  {
    key: 'sales_value',
    label: 'Value they sold — new business and upsells',
    group: 'Sales',
    noun: 'value sold incl. upsells',
    unit: 'currency',
    hint: 'Annual value of every deal credited to them, Closed Won and upsells together, counted in the period they were sold, paid at one rate.',
    caution: 'This already includes upsells. If the same person also has a rule paid on upsells, every upsell is paid twice — use “new business only” for one of them.',
  },
  {
    key: 'sales_count',
    label: 'Number of sales they closed — new business and upsells',
    group: 'Sales',
    noun: 'sales incl. upsells',
    unit: 'count',
    hint: 'How many deals they closed in the period in total, rather than what those deals were worth.',
    caution: 'This already includes upsells. If the same person also has a rule paid on upsells, every upsell is counted twice — use “new business only” for one of them.',
  },
  {
    key: 'revenue_produced',
    label: 'Revenue they produced',
    group: 'Work done',
    noun: 'revenue they produced',
    unit: 'currency',
    hint: 'Value of the completed visits credited to them — work done, not work sold.',
    /* ⚠⚠ The one basis with a real accuracy problem, and it costs money rather than
     * looking untidy. A visit worked by two technicians credits its full value to
     * BOTH (that is how every technician board reports it), so paying a percentage
     * on this figure overpays. Measured on Heroes' 2026 book: $16,331 of $429,475,
     * or 3.8%. Stated on the card and here, because a silent 3.8% overpayment
     * compounds every period and nobody would spot it. */
    caution: 'A visit worked by two people credits its full value to both, so this figure runs about 3.8% above what the company actually produced. Paying a straight percentage on it overpays slightly.',
  },
  {
    key: 'line_revenue',
    label: 'Revenue of a whole service line',
    group: 'Work done',
    noun: 'service-line revenue',
    unit: 'currency',
    hint: 'The department’s revenue, not this person’s — for a lead who is paid on how their line performs.',
    needs: 'line',
  },
  /* ── Efficiency: the two ratios off the Crew & Labor report ─────────────────
   *
   * Ben: "Need the ability to set up a commission/bonus for hitting a revenue per
   * hour figure and one for the payroll to production revenue %."
   *
   * ⚠⚠ THESE ARE PAID BY TARGET, NOT BY RATE, and that is not a UI convenience — it
   * is the only honest arithmetic. Every basis above is an AMOUNT, so a percentage or
   * a per-unit rate scales with it. These two are RATIOS: $91.84 an hour and 23.4% of
   * revenue. There is no rate you can apply to a ratio that produces a bonus, so the
   * rule instead names a line and a flat amount for clearing it.
   *
   * ⚠⚠ BOTH SCOPES EXIST ON PURPOSE. A technician's own revenue per hour is a
   * statement about their day; the company's is a statement about the business, and a
   * crew lead or GM is paid on the second. `line_revenue` already set this precedent —
   * "the department's revenue, not this person's". The labels say which is which,
   * because the two are indistinguishable on a payslip and completely different bets.
   *
   * ⚠ Both figures come from Crew & Labor, which CLAMPS its window to where timeclock
   * data exists. That is safe here and would not be for a total: a ratio measured over
   * a shorter period is still the right ratio, whereas a shortened total is just a
   * smaller number. The card names the days it actually measured.
   */
  {
    key: 'rev_per_hour',
    label: 'Their revenue per labour hour — hitting a target',
    group: 'Efficiency',
    noun: 'their revenue per labour hour',
    unit: 'money_per_hour',
    better: 'higher',
    hint: 'The completed work credited to them divided by the hours they clocked — the per-person figure on the Crew & Labor report. Pays a flat bonus for reaching a target, because a percentage of a $/hour figure is not a number anybody can use.',
    caution: 'Different services carry different price tags, so a fair target for an irrigation tech is not a fair target for a mowing crew. Nobody with no clocked hours is paid — the rule says so rather than reading zero.',
  },
  {
    key: 'company_rev_per_hour',
    label: 'The COMPANY’S revenue per labour hour — hitting a target',
    group: 'Efficiency',
    noun: 'the company’s revenue per labour hour',
    unit: 'money_per_hour',
    better: 'higher',
    companyWide: true,
    hint: 'The whole crew’s completed work divided by the whole crew’s clocked hours — the headline figure on Crew & Labor. For a lead or manager paid on how the business performs rather than on their own day.',
    caution: 'Everybody holding this rule is paid on the same number, so it either pays all of them or none of them.',
  },
  {
    key: 'labor_pct',
    label: 'Their payroll as a % of the revenue they produced — staying under a target',
    group: 'Efficiency',
    noun: 'their payroll as a share of the revenue they produced',
    unit: 'percent',
    better: 'lower',
    hint: 'Their regular pay, overtime and commission divided by the completed work credited to them. LOWER is better, so the target is a ceiling: the bonus pays when they are at or below it.',
    /* ⚠ Bonnie Simpson reads 80% on Heroes' live book — not because she is expensive
     * but because almost no completed work is credited to her. A share is only a
     * statement about efficiency when the denominator is that person's actual output. */
    caution: 'Only meaningful for people whose completed work is credited to them. Office and support staff clock real hours against almost no credited revenue, so their percentage looks catastrophic and means nothing — on Heroes’ own book one reads 80%.',
  },
  {
    key: 'company_labor_pct',
    label: 'The COMPANY’S payroll as a % of production revenue — staying under a target',
    group: 'Efficiency',
    noun: 'the company’s payroll as a share of production revenue',
    unit: 'percent',
    better: 'lower',
    companyWide: true,
    hint: 'Field payroll — regular, overtime and commission — divided by the revenue the crew completed, the Labor Cost % figure on Crew & Labor. LOWER is better, so the target is a ceiling.',
    caution: 'Holiday pay, PTO, bonuses, tips and every salaried person are OUT of this figure, so true payroll load is higher than the percentage a bonus is paid on. Everybody holding this rule is paid on the same number.',
  },
  {
    key: 'item_count',
    label: 'Particular things they sold',
    group: 'Products',
    noun: 'tracked items sold',
    unit: 'count',
    hint: 'How many of the products you pick they sold, from the Lead Tracker’s Service column.',
    needs: 'items',
  },
]

/** The editor's optgroups, in the order they are offered. */
export const BASIS_GROUPS: BasisGroup[] = ['Sales', 'Work done', 'Efficiency', 'Products']

/**
 * Bases that already contain upsells, so pairing one with an upsell rule double-pays.
 * Named here rather than in the widget so the editor and the card agree on the set.
 */
export const BASES_INCLUDING_UPSELLS = new Set<CommissionBasis>(['sales_value', 'sales_count'])
export const UPSELL_ONLY_BASES = new Set<CommissionBasis>(['upsell_value', 'upsell_count'])

const BY_BASIS = new Map(COMMISSION_BASES.map(b => [b.key, b]))

export function getBasis(key: string): CommissionBasisDef | null {
  return BY_BASIS.get(key as CommissionBasis) ?? null
}

/**
 * Which rate kinds a basis can honestly use.
 *
 * ⚠ A percentage of a COUNT is meaningless ("3% of 7 controllers"), and a flat
 * amount per unit of a DOLLAR figure is meaningless too. Rather than let a plan be
 * saved that could only ever produce a nonsense number, the pairing is constrained
 * in one place and the editor offers only the valid options.
 */
export function rateKindsFor(unit: BasisUnit): RateKind[] {
  // A ratio takes neither: it is paid for being on the right side of a line.
  if (RATIO_UNITS.has(unit)) return ['target_flat', 'target_tiered']
  return unit === 'currency' ? ['percent', 'tiered'] : ['per_unit']
}

/** Rate kinds that pay a flat amount for clearing a line rather than a rate on a figure. */
export const TARGET_RATE_KINDS = new Set<RateKind>(['target_flat', 'target_tiered'])
/** Rate kinds whose numbers live in `tiers` rather than in `rate`. */
export const BANDED_RATE_KINDS = new Set<RateKind>(['tiered', 'target_tiered'])

export function isTargetKind(kind: string): boolean {
  return TARGET_RATE_KINDS.has(kind as RateKind)
}
export function isBandedKind(kind: string): boolean {
  return BANDED_RATE_KINDS.has(kind as RateKind)
}

export function rateKindAllowed(basis: string, kind: string): boolean {
  const def = getBasis(basis)
  if (!def) return false
  return (rateKindsFor(def.unit) as string[]).includes(kind)
}

/**
 * The figure a rule rides on, written the way its own report writes it.
 *
 * ⚠⚠ ONE COLUMN, FOUR UNITS. "$7.00" where the truth is "7 controllers" is a wrong
 * number rather than a formatting quirk, and "$91.84" where the truth is "$91.84 an
 * hour" is worse — it reads as a trivial figure instead of a good one. Every place
 * that prints a basis amount goes through here so they cannot disagree.
 */
export function formatBasisAmount(def: CommissionBasisDef | null, n: number): string {
  const v = Number.isFinite(n) ? n : 0
  switch (def?.unit) {
    case 'money_per_hour': return `${formatCurrency(v, { decimals: 2 })}/hr`
    // One decimal, matching the Crew & Labor card: 23.4%, not 23.42% and not 23%.
    case 'percent': return `${Math.round(v * 10) / 10}%`
    case 'currency': return formatCurrency(v)
    default: return v.toLocaleString('en-US')
  }
}

/** A bonus amount. Cents only when there are cents — "$500.00" reads like a form field. */
function money(n: number): string {
  return formatCurrency(n, { decimals: Number.isInteger(n) ? 0 : 2 })
}

export type CommissionTier = { from: number; rate: number }

export type CommissionPlan = {
  id: string
  employee_id: string
  label: string
  basis: CommissionBasis
  rate_kind: RateKind
  rate: number | null
  tiers: CommissionTier[] | null
  threshold: number | null
  cap: number | null
  line_prefix: string | null
  items: string[] | null
  active: boolean
  sort_order: number
}

/**
 * Marginal bands, sorted and cleaned.
 *
 * ⚠ Marginal, not flat-at-tier: "3% up to $50k then 5%" pays 3% on the first $50k
 * and 5% only on the excess. The alternative reading — 5% on everything once you
 * cross — creates a cliff where selling one more dollar can pay hundreds more, and
 * that is a thing people notice in their own paycheque. The card says which it did.
 */
export function normalizeTiers(raw: unknown): CommissionTier[] {
  const arr = Array.isArray(raw) ? raw : []
  const out: CommissionTier[] = []
  for (const t of arr) {
    if (!t || typeof t !== 'object') continue
    const o = t as Record<string, unknown>
    const from = Number(o.from)
    const rate = Number(o.rate)
    if (!Number.isFinite(from) || from < 0) continue
    if (!Number.isFinite(rate) || rate < 0) continue
    out.push({ from, rate })
  }
  out.sort((a, b) => a.from - b.from)
  // Two bands starting at the same place cannot both apply; keep the later one, which
  // is what someone editing a row would expect their newest edit to do.
  return out.filter((t, i) => i === out.length - 1 || out[i + 1].from !== t.from)
}

export type Payout = {
  /** What the rule pays before threshold and cap. */
  gross: number
  /** What it actually pays. */
  paid: number
  /**
   * Set when the payout was reduced, so a card can say why rather than just showing a
   * smaller number. `target` means the figure never reached the line at all — kept
   * separate from `threshold` because they read differently to the person being paid:
   * a threshold is "not yet", a missed target is "not this period".
   */
  limitedBy?: 'threshold' | 'cap' | 'target'
  /** Set when the rule cannot compute — a mismatched rate kind, or missing bands. */
  problem?: string
}

/** Cents-rounded, and reduced to the cap when one is set. Shared by every rate kind. */
function capped(plan: CommissionPlan, gross: number): Payout {
  const g = Math.round(gross * 100) / 100
  if (plan.cap != null && g > plan.cap) {
    return { gross: g, paid: Math.round(plan.cap * 100) / 100, limitedBy: 'cap' }
  }
  return { gross: g, paid: g }
}

/**
 * A target bonus: a flat amount, paid only for being on the right side of a line.
 *
 * ⚠⚠ NOTHING IS PRORATED AND NOTHING IS MARGINAL, and unlike the tiered percentages
 * above that is the correct behaviour rather than a compromise. "$500 for hitting $100
 * an hour" pays $500 at $100.01 and nothing at $99.99. That IS what a target is; a
 * smooth version of it would be a different bonus from the one being described, and
 * quietly paying a fraction for nearly hitting it would be inventing a rule nobody
 * agreed to. The card shows the figure against the target so the cliff is visible.
 *
 * ⚠⚠ THE DIRECTION COMES FROM THE BASIS, NEVER FROM THE RULE. Revenue per hour has to
 * REACH its target; payroll-as-a-share has to stay AT OR BELOW it. Reading a ceiling as
 * a floor would pay the labour-percentage bonus in the company's worst month and
 * withhold it in its best — a wrong number that looks like a working feature.
 */
function targetPayout(plan: CommissionPlan, def: CommissionBasisDef, base: number): Payout {
  const hit = (target: number) => def.better === 'lower' ? base <= target : base >= target

  if (plan.rate_kind === 'target_flat') {
    // ⚠ No target means no line to be on the right side of. Paying anyway would pay
    // everybody every period; paying zero silently would read as "nobody hit it".
    if (plan.threshold == null) return { gross: 0, paid: 0, problem: 'no target set' }
    if (!hit(plan.threshold)) return { gross: 0, paid: 0, limitedBy: 'target' }
    return capped(plan, Number(plan.rate) || 0)
  }

  const tiers = normalizeTiers(plan.tiers)
  if (!tiers.length) return { gross: 0, paid: 0, problem: 'no bands set' }
  /* The BEST band reached, paid ONCE — not the sum of every band cleared. Ordered so
   * the hardest band is last and therefore wins: ascending when higher is better,
   * descending when lower is better. Stacking the bands instead would pay $600 for a
   * "$200 at 90, $400 at 100" rule, which is not what either number says. */
  const hardestLast = def.better === 'lower' ? [...tiers].reverse() : tiers
  let amount = 0
  for (const t of hardestLast) if (hit(t.from)) amount = t.rate
  if (!amount) return { gross: 0, paid: 0, limitedBy: 'target' }
  return capped(plan, amount)
}

/** What one rule pays on a given basis amount. Pure arithmetic. */
export function payout(plan: CommissionPlan, amount: number): Payout {
  const def = getBasis(plan.basis)
  if (!def) return { gross: 0, paid: 0, problem: 'unknown basis' }
  if (!rateKindAllowed(plan.basis, plan.rate_kind)) {
    return {
      gross: 0,
      paid: 0,
      problem: RATIO_UNITS.has(def.unit)
        ? 'a ratio is paid for hitting a target, not by a rate applied to it'
        : def.unit === 'count'
          ? 'a count needs a flat amount per unit, not a percentage'
          : 'a dollar figure needs a percentage, not an amount per unit',
    }
  }

  const base = Number.isFinite(amount) ? Math.max(0, amount) : 0

  /* ⚠ Ratio bases leave here. Everything below applies a RATE to an amount, and the
   * generic threshold gate below is a floor — on a lower-is-better figure a floor is
   * exactly backwards, which is why the comparison lives in `targetPayout` where the
   * basis's own direction is in scope. */
  if (isTargetKind(plan.rate_kind)) return targetPayout(plan, def, base)

  // ⚠ The threshold gates on the BASIS, not on the payout — "nothing until you sell
  // $20k" is a statement about sales, and applying it to the commission instead would
  // silently move the bar.
  if (plan.threshold != null && base < plan.threshold) {
    return { gross: 0, paid: 0, limitedBy: 'threshold' }
  }

  let gross = 0
  if (plan.rate_kind === 'percent') {
    gross = base * (Number(plan.rate) || 0) / 100
  } else if (plan.rate_kind === 'per_unit') {
    gross = base * (Number(plan.rate) || 0)
  } else {
    const tiers = normalizeTiers(plan.tiers)
    if (!tiers.length) return { gross: 0, paid: 0, problem: 'no tiers set' }
    for (let i = 0; i < tiers.length; i++) {
      const from = tiers[i].from
      const to = i + 1 < tiers.length ? tiers[i + 1].from : Infinity
      const span = Math.min(base, to) - from
      if (span > 0) gross += span * (tiers[i].rate || 0) / 100
    }
  }

  return capped(plan, gross)
}

/**
 * "$500 when their revenue per labour hour is at or above $100.00/hr" — the sentence
 * for a target rule.
 *
 * ⚠ "at or above" / "at or below" is read from the basis, the same field `payout()`
 * compares on, so the sentence and the arithmetic cannot drift. Bands are printed
 * HARDEST FIRST, because that is the number the rule is really about.
 */
function describeTarget(plan: CommissionPlan, def: CommissionBasisDef | null): string {
  const dir = def?.better === 'lower' ? 'at or below' : 'at or above'
  const of = def ? def.noun : plan.basis

  if (plan.rate_kind === 'target_flat') {
    if (plan.threshold == null) return `flat bonus on ${of} — no target set`
    return `${money(Number(plan.rate) || 0)} when ${of} is ${dir} ${formatBasisAmount(def, plan.threshold)}`
  }

  const tiers = normalizeTiers(plan.tiers)
  if (!tiers.length) return `stepped bonus on ${of} — no bands set`
  const hardestFirst = def?.better === 'lower' ? tiers : [...tiers].reverse()
  const bands = hardestFirst
    .map(t => `${money(t.rate)} ${dir} ${formatBasisAmount(def, t.from)}`)
    .join(', ')
  return `${bands} — best band only, on ${of}`
}

/** "5% of value they sold", "$50 per controller sold" — one line, for a card or the editor. */
export function describeRule(plan: CommissionPlan): string {
  const def = getBasis(plan.basis)
  const of = def ? def.noun : plan.basis
  // A target rule has no rate to apply and no floor to add — its whole sentence is
  // the target, so it is written in one piece rather than assembled from clauses.
  if (isTargetKind(plan.rate_kind)) return describeTarget(plan, def)
  let rule: string
  if (plan.rate_kind === 'percent') rule = `${plan.rate ?? 0}% of ${of}`
  else if (plan.rate_kind === 'per_unit') rule = `$${plan.rate ?? 0} per unit of ${of}`
  else {
    const tiers = normalizeTiers(plan.tiers)
    rule = tiers.length
      ? `${tiers.map(t => `${t.rate}% over $${t.from.toLocaleString('en-US')}`).join(', ')} (marginal)`
      : `tiered ${of} — no bands set`
  }
  const extra: string[] = []
  if (plan.basis === 'line_revenue' && plan.line_prefix) extra.push(`${plan.line_prefix} line`)
  if (plan.basis === 'item_count' && plan.items?.length) extra.push(plan.items.join(', '))
  /* ⚠ The unit, not a hardcoded "$". A threshold on a COUNT basis read "nothing under
   * $3" on a live rule of Ben's that means "nothing under 3 upsells" — a dollar sign on
   * a number of deals, which reads as a tiny money floor rather than a real one. */
  if (plan.threshold != null) {
    extra.push(def?.unit === 'count'
      ? `nothing under ${plan.threshold.toLocaleString('en-US')} ${def.noun}`
      : `nothing under ${formatBasisAmount(def, plan.threshold)}`)
  }
  if (plan.cap != null) extra.push(`capped at $${plan.cap.toLocaleString('en-US')}`)
  return extra.length ? `${rule} · ${extra.join(' · ')}` : rule
}
