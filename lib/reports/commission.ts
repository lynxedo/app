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
  | 'sales_value'
  | 'sales_count'
  | 'revenue_produced'
  | 'line_revenue'
  | 'item_count'

export type RateKind = 'percent' | 'per_unit' | 'tiered'

/** Money or a tally — decides which rate kinds even make sense. */
export type BasisUnit = 'currency' | 'count'

export type CommissionBasisDef = {
  key: CommissionBasis
  label: string
  unit: BasisUnit
  /** One line in the editor: what it measures, and what to watch. */
  hint: string
  /** An extra field this basis cannot work without. */
  needs?: 'line' | 'items'
  /** Shown as a warning in the editor — a real caveat about paying on this figure. */
  caution?: string
}

export const COMMISSION_BASES: CommissionBasisDef[] = [
  {
    key: 'sales_value',
    label: 'Value they sold',
    unit: 'currency',
    hint: 'Annual value of the deals credited to them in the Lead Tracker, including upsells if you count those as sales.',
  },
  {
    key: 'sales_count',
    label: 'Number of sales they closed',
    unit: 'count',
    hint: 'How many deals they closed, rather than what those deals were worth.',
  },
  {
    key: 'revenue_produced',
    label: 'Revenue they produced',
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
    unit: 'currency',
    hint: 'The department’s revenue, not this person’s — for a lead who is paid on how their line performs.',
    needs: 'line',
  },
  {
    key: 'item_count',
    label: 'Particular things they sold',
    unit: 'count',
    hint: 'How many of the products you pick they sold, from the Lead Tracker’s Service column.',
    needs: 'items',
  },
]

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
  return unit === 'currency' ? ['percent', 'tiered'] : ['per_unit']
}

export function rateKindAllowed(basis: string, kind: string): boolean {
  const def = getBasis(basis)
  if (!def) return false
  return (rateKindsFor(def.unit) as string[]).includes(kind)
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
  /** Set when the payout was reduced, so a card can say why rather than just showing a smaller number. */
  limitedBy?: 'threshold' | 'cap'
  /** Set when the rule cannot compute — a mismatched rate kind, or missing bands. */
  problem?: string
}

/** What one rule pays on a given basis amount. Pure arithmetic. */
export function payout(plan: CommissionPlan, amount: number): Payout {
  const def = getBasis(plan.basis)
  if (!def) return { gross: 0, paid: 0, problem: 'unknown basis' }
  if (!rateKindAllowed(plan.basis, plan.rate_kind)) {
    return {
      gross: 0,
      paid: 0,
      problem: def.unit === 'count'
        ? 'a count needs a flat amount per unit, not a percentage'
        : 'a dollar figure needs a percentage, not an amount per unit',
    }
  }

  const base = Number.isFinite(amount) ? Math.max(0, amount) : 0

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

  gross = Math.round(gross * 100) / 100
  if (plan.cap != null && gross > plan.cap) {
    return { gross, paid: Math.round(plan.cap * 100) / 100, limitedBy: 'cap' }
  }
  return { gross, paid: gross }
}

/** "5% of value they sold", "$50 per controller sold" — one line, for a card or the editor. */
export function describeRule(plan: CommissionPlan): string {
  const def = getBasis(plan.basis)
  const of = def ? def.label.toLowerCase() : plan.basis
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
  if (plan.threshold != null) extra.push(`nothing under $${plan.threshold.toLocaleString('en-US')}`)
  if (plan.cap != null) extra.push(`capped at $${plan.cap.toLocaleString('en-US')}`)
  return extra.length ? `${rule} · ${extra.join(' · ')}` : rule
}
