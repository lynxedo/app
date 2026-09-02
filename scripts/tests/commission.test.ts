/* The commission arithmetic, against Ben's own August 2026 figures.
 *
 * ⚠⚠ THE NUMBERS IN HERE ARE NOT INVENTED. Every expectation was read off the live
 * book first (Heroes, company …0002, August 2026) and only then written down, so a
 * failure here means the engine has stopped agreeing with what three people are
 * actually owed. The revenue figures come from `visits` + `line_items` dated by
 * `scheduled_date` and split evenly across the techs on the visit; the hours from
 * `time_entries.total_hours`.
 *
 * These are pure-function tests. They deliberately do NOT touch the database: the
 * database half is verified by the reconciliation SQL in the session notes, and a test
 * that needed live credentials would not run.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  type CommissionPlan, PLAN_DEFAULTS, describeRule, payout, payoutOverPeriods,
  planCoversPeriod, tieredGross,
} from '../../lib/reports/commission'
import {
  commissionMonth, commissionMonthStart, commissionWeeks, encodeBuckets,
} from '../../lib/scoreboards/widgets/windows'

/** A plan with everything defaulted, so each test states only what it is about. */
function plan(over: Partial<CommissionPlan>): CommissionPlan {
  return {
    id: 'p', employee_id: 'e', label: 'Rule',
    basis: 'revenue_produced', rate_kind: 'percent',
    rate: null, tiers: null, threshold: null, cap: null,
    line_prefix: null, items: null, active: true, sort_order: 0,
    ...PLAN_DEFAULTS,
    ...over,
  }
}

/** Josh Allen's real Personal Production bands. */
const JOSH_TIERS = [
  { from: 4000, rate: 0.25 }, { from: 4500, rate: 0.5 }, { from: 5000, rate: 0.75 },
  { from: 6000, rate: 1 }, { from: 7000, rate: 1.5 }, { from: 8000, rate: 2 },
  { from: 9000, rate: 2.5 }, { from: 10000, rate: 3 },
]

/** Josh's four bonus weeks of August 2026, from the live book. */
const JOSH_AUG = [
  { key: 'W1', label: 'W1 Jul 27 – Aug 2', amount: 4019.03 },
  { key: 'W2', label: 'W2 Aug 3 – 9', amount: 4862.25 },
  { key: 'W3', label: 'W3 Aug 10 – 16', amount: 3188.08 },
  { key: 'W4', label: 'W4 Aug 17 – 23', amount: 1821.90 },
]

describe('bonus weeks', () => {
  test('W1 starts on the last Monday on or before the 1st', () => {
    // Aug 1 2026 is a Saturday, so W1 reaches back to Jul 27.
    assert.equal(commissionMonthStart(2026, 8), '2026-07-27')
    // Jun 1 2026 IS a Monday — the boundary case that must not reach back a week.
    assert.equal(commissionMonthStart(2026, 6), '2026-06-01')
    // Nov 1 2026 is a Sunday: the furthest reach-back there is.
    assert.equal(commissionMonthStart(2026, 11), '2026-10-26')
  })

  test('August 2026 is W1 Jul27–Aug2 … W4 Aug17–23', () => {
    assert.deepEqual(
      commissionWeeks(2026, 8).map(w => [w.start, w.end]),
      [['2026-07-27', '2026-08-02'], ['2026-08-03', '2026-08-09'],
       ['2026-08-10', '2026-08-16'], ['2026-08-17', '2026-08-23']],
    )
  })

  test('the window’s END month decides the bonus month', () => {
    // A board asking for Aug 1–31 is an AUGUST board even though W1 begins in July.
    const cm = commissionMonth({ start: '2026-08-01', end: '2026-08-31', label: '', phrase: '' })
    assert.equal(cm.month, 8)
    assert.equal(cm.start, '2026-07-27')
    assert.equal(cm.end, '2026-08-23')
  })

  test('an orphaned week is reported, not absorbed', () => {
    /* ⚠ Four bonus weeks is 28 days, so August 2026 leaves Aug 24–30 outside both
     * W1–W4 and September's own W1 (which starts Aug 31). Work done then is in nobody's
     * bonus period. That is a property of Ben's W1–W4 rule, and the card must be able
     * to say so rather than quietly paying nothing for a week. */
    const aug = commissionMonth({ start: '2026-08-01', end: '2026-08-31', label: '', phrase: '' })
    assert.deepEqual(aug.orphanedDays, { start: '2026-08-24', end: '2026-08-30' })
    // Most months tile cleanly and must report no gap at all.
    const sep = commissionMonth({ start: '2026-09-01', end: '2026-09-30', label: '', phrase: '' })
    assert.equal(sep.orphanedDays, null)
  })

  test('buckets are encoded for the RPC in W-order', () => {
    assert.equal(
      encodeBuckets(commissionWeeks(2026, 8)),
      'W1:2026-07-27:2026-08-02,W2:2026-08-03:2026-08-09,W3:2026-08-10:2026-08-16,W4:2026-08-17:2026-08-23',
    )
  })
})

describe('flat vs marginal bands', () => {
  test('flat pays the reached band’s rate on the WHOLE figure', () => {
    // W2: $4,862.25 clears the $4,500 band, so 0.5% of all of it.
    assert.equal(Math.round(tieredGross(JOSH_TIERS, 4862.25, 'flat') * 100) / 100, 24.31)
    // W1: $4,019.03 clears only the $4,000 band → 0.25% of all of it.
    assert.equal(Math.round(tieredGross(JOSH_TIERS, 4019.03, 'flat') * 100) / 100, 10.05)
  })

  test('marginal pays each band only on the slice above it', () => {
    // The SAME week, the other mode: 0.25% of $500 + 0.5% of $362.25 = $3.06.
    assert.equal(Math.round(tieredGross(JOSH_TIERS, 4862.25, 'marginal') * 100) / 100, 3.06)
  })

  test('the two modes are nowhere near each other — so the default matters', () => {
    /* $24.31 against $3.06 on one real week of Josh's. Not a rounding difference:
     * getting the mode wrong is an 8x pay error, which is why it is stored per rule
     * and why `describeRule` prints which one is in force. */
    const flat = tieredGross(JOSH_TIERS, 4862.25, 'flat')
    const marginal = tieredGross(JOSH_TIERS, 4862.25, 'marginal')
    assert.ok(flat > marginal * 5, `${flat} should dwarf ${marginal}`)
    assert.equal(Math.round(flat * 100) / 100, 24.31)
    assert.equal(Math.round(marginal * 100) / 100, 3.06)
  })

  test('below the first band both modes pay nothing', () => {
    assert.equal(tieredGross(JOSH_TIERS, 3188.08, 'flat'), 0)
    assert.equal(tieredGross(JOSH_TIERS, 3188.08, 'marginal'), 0)
  })

  test('a plan defaults to marginal, so no existing rule moves', () => {
    assert.equal(plan({}).tier_mode, 'marginal')
    const p = plan({ rate_kind: 'tiered', tiers: JOSH_TIERS })
    // 7549.40 was Josh's clipped August figure; monthly-and-marginal paid $29.49.
    assert.equal(payout(p, 7549.40).paid, 29.49)
  })
})

describe('weekly vs monthly period', () => {
  test('Josh’s August: by week on the full week’s revenue = $34.36', () => {
    const p = plan({ rate_kind: 'tiered', tiers: JOSH_TIERS, period: 'week', tier_mode: 'flat' })
    const out = payoutOverPeriods(p, JOSH_AUG)
    assert.deepEqual(out.parts.map(x => x.paid), [10.05, 24.31, 0, 0])
    assert.equal(out.paid, 34.36)
  })

  test('a week under the lowest band pays $0 for that week, not a share', () => {
    const p = plan({ rate_kind: 'tiered', tiers: JOSH_TIERS, period: 'week', tier_mode: 'flat' })
    const out = payoutOverPeriods(p, JOSH_AUG)
    assert.equal(out.parts[2].paid, 0)   // W3 $3,188.08
    assert.equal(out.parts[3].paid, 0)   // W4 $1,821.90
  })

  test('a week not worked pays nothing and is NOT prorated', () => {
    const p = plan({ rate_kind: 'tiered', tiers: JOSH_TIERS, period: 'week', tier_mode: 'flat' })
    const out = payoutOverPeriods(p, [
      { key: 'W1', label: 'W1', amount: 8000 },
      { key: 'W2', label: 'W2', amount: 0 },
      { key: 'W3', label: 'W3', amount: 0 },
      { key: 'W4', label: 'W4', amount: 0 },
    ])
    // 2% of $8,000 and nothing else. Averaging the month would have paid on $2,000/wk.
    assert.equal(out.paid, 160)
    assert.deepEqual(out.parts.map(x => x.paid), [160, 0, 0, 0])
  })

  test('the same weeks summed FIRST clear a much higher band — which is the bug', () => {
    /* ⚠ The whole reason `period` exists. Josh's four weeks total $13,891.26; priced
     * as one figure against a flat band structure that is the 3% band on the lot —
     * $416.74 against the $34.36 he is actually owed. */
    const monthly = plan({ rate_kind: 'tiered', tiers: JOSH_TIERS, tier_mode: 'flat' })
    const total = JOSH_AUG.reduce((t, w) => t + w.amount, 0)
    assert.equal(payout(monthly, total).paid, 416.74)
  })

  test('a threshold gates each week; a cap limits the month', () => {
    const p = plan({
      rate_kind: 'percent', rate: 10, period: 'week', threshold: 1000, cap: 250,
    })
    const out = payoutOverPeriods(p, [
      { key: 'W1', label: 'W1', amount: 900 },    // under the threshold → nothing
      { key: 'W2', label: 'W2', amount: 2000 },   // $200
      { key: 'W3', label: 'W3', amount: 2000 },   // $200
      { key: 'W4', label: 'W4', amount: 0 },
    ])
    assert.equal(out.gross, 400)
    assert.equal(out.paid, 250)              // capped ONCE, not per week
    assert.equal(out.limitedBy, 'cap')
    assert.equal(out.parts[0].limitedBy, 'threshold')
  })

  test('a month where every week missed reports as a threshold miss', () => {
    const p = plan({ rate_kind: 'percent', rate: 10, period: 'week', threshold: 5000 })
    const out = payoutOverPeriods(p, JOSH_AUG)
    assert.equal(out.paid, 0)
    assert.equal(out.limitedBy, 'threshold')
  })

  test('a month where SOME weeks paid does not claim a threshold miss', () => {
    const p = plan({ rate_kind: 'tiered', tiers: JOSH_TIERS, period: 'week', tier_mode: 'flat' })
    const out = payoutOverPeriods(p, JOSH_AUG)
    assert.equal(out.limitedBy, undefined)
  })
})

describe('Lucas: revenue per hour over the bonus weeks', () => {
  const LUCAS_TIERS = [
    { from: 85, rate: 95 }, { from: 90, rate: 190 }, { from: 100, rate: 285 },
    { from: 110, rate: 380 }, { from: 119, rate: 475 }, { from: 125, rate: 570 },
  ]

  test('$14,906.90 over 201.48 hrs is $73.99/hr — below the $85 floor, so $0', () => {
    const rate = Math.round((14906.90 / 201.48) * 100) / 100
    assert.equal(rate, 73.99)
    const p = plan({ basis: 'rev_per_hour', rate_kind: 'target_tiered', tiers: LUCAS_TIERS, period: 'commission_weeks' })
    const out = payout(p, rate)
    assert.equal(out.paid, 0)
    assert.equal(out.limitedBy, 'target')
  })

  test('the clipped figure missed for the same reason but off the wrong number', () => {
    // $62.01 was what the payroll-clamped source reported. Same verdict, wrong basis —
    // which is exactly the kind of bug a passing test can hide, so both are asserted.
    const p = plan({ basis: 'rev_per_hour', rate_kind: 'target_tiered', tiers: LUCAS_TIERS })
    assert.equal(payout(p, 62.01).paid, 0)
    assert.equal(payout(p, 73.99).paid, 0)
    // …and the first band it WOULD have paid, so the test proves the ladder works.
    assert.equal(payout(p, 85).paid, 95)
    assert.equal(payout(p, 121).paid, 475)
  })

  test('a rate is one figure over the whole four weeks, never an average of four', () => {
    /* ⚠ The trap this guards. Two weeks at $100/hr over 10 hrs and $50/hr over 190 hrs
     * average to $75 unweighted but are $52.50 in truth. An unweighted mean of rates
     * over unequal hours is a different and wrong number, so the engine divides total
     * revenue by total hours — asserted here as arithmetic so the intent is recorded. */
    const rev = 100 * 10 + 50 * 190
    const hrs = 10 + 190
    assert.equal(Math.round((rev / hrs) * 100) / 100, 52.5)
    assert.notEqual(Math.round((rev / hrs) * 100) / 100, 75)
  })
})

describe('Mike Cyplik must not move', () => {
  test('8% of $9,588.96 new business = $767.12', () => {
    const p = plan({ basis: 'new_sales_value', rate_kind: 'percent', rate: 8 })
    assert.equal(payout(p, 9588.96).paid, 767.12)
  })
  test('5% of $2,585 upsells = $129.25', () => {
    const p = plan({ basis: 'upsell_value', rate_kind: 'percent', rate: 5 })
    assert.equal(payout(p, 2585).paid, 129.25)
  })
  test('$10 × 5 upsells over a threshold of 3 = $50', () => {
    const p = plan({ basis: 'upsell_count', rate_kind: 'per_unit', rate: 10, threshold: 3 })
    assert.equal(payout(p, 5).paid, 50)
    // …and the threshold still bites below it, on the BASIS not the payout.
    assert.equal(payout(p, 2).paid, 0)
    assert.equal(payout(p, 2).limitedBy, 'threshold')
  })
  test('his four rules total $946.37', () => {
    const total =
      payout(plan({ basis: 'new_sales_value', rate_kind: 'percent', rate: 8 }), 9588.96).paid
      + payout(plan({ basis: 'upsell_value', rate_kind: 'percent', rate: 5 }), 2585).paid
      + payout(plan({ basis: 'upsell_count', rate_kind: 'per_unit', rate: 10, threshold: 3 }), 5).paid
      + payout(plan({ basis: 'item_count', rate_kind: 'per_unit', rate: 25 }), 0).paid
    assert.equal(Math.round(total * 100) / 100, 946.37)
  })
  test('none of his rules opt into any new behaviour', () => {
    // The defaults ARE his behaviour. If this ever fails, a default has been changed.
    const p = plan({})
    assert.equal(p.period, 'month')
    assert.equal(p.tier_mode, 'marginal')
    assert.equal(p.verify_source, null)
    assert.equal(p.min_price, null)
    assert.equal(p.exclude_renewals, false)
  })
})

describe('effective dating', () => {
  test('an undated rule applies to every period', () => {
    assert.ok(planCoversPeriod(plan({}), '2026-04-01', '2026-04-30'))
    assert.ok(planCoversPeriod(plan({}), '2020-01-01', '2020-12-31'))
  })
  test('a rule that ended does not apply to a later period', () => {
    const p = plan({ effective_to: '2026-04-30' })
    assert.ok(planCoversPeriod(p, '2026-04-01', '2026-04-30'))
    assert.ok(!planCoversPeriod(p, '2026-08-01', '2026-08-31'))
  })
  test('a rule that started later does not apply to an earlier period', () => {
    const p = plan({ effective_from: '2026-05-01' })
    assert.ok(!planCoversPeriod(p, '2026-04-01', '2026-04-30'))
    assert.ok(planCoversPeriod(p, '2026-08-01', '2026-08-31'))
  })
  test('the April $35-per-upsell rule stays reproducible beside its 5% replacement', () => {
    /* The case that motivated the columns: April 2026 paid a flat $35 per upsell and
     * became unreproducible once the rule became 5%. Two dated versions, and each
     * period reads its own. */
    const april = plan({ basis: 'upsell_count', rate_kind: 'per_unit', rate: 35, effective_to: '2026-04-30' })
    const now = plan({ basis: 'upsell_value', rate_kind: 'percent', rate: 5, effective_from: '2026-05-01' })
    assert.ok(planCoversPeriod(april, '2026-04-01', '2026-04-30'))
    assert.ok(!planCoversPeriod(now, '2026-04-01', '2026-04-30'))
    assert.equal(payout(april, 4).paid, 140)
  })
  test('a mid-period rule change still shows on a monthly card', () => {
    // Overlap, not containment — a rule effective from the 15th earned for part of it.
    assert.ok(planCoversPeriod(plan({ effective_from: '2026-08-15' }), '2026-08-01', '2026-08-31'))
  })
})

describe('the rule sentence cannot drift from the arithmetic', () => {
  test('a flat-tier rule does not describe itself as marginal', () => {
    const p = plan({ rate_kind: 'tiered', tiers: JOSH_TIERS, tier_mode: 'flat', period: 'week' })
    const s = describeRule(p)
    assert.ok(s.includes('band reached pays on the whole figure'), s)
    assert.ok(!s.includes('(marginal)'), s)
    assert.ok(s.includes('each bonus week'), s)
  })
  test('a marginal rule still says marginal', () => {
    assert.ok(describeRule(plan({ rate_kind: 'tiered', tiers: JOSH_TIERS })).includes('(marginal)'))
  })
  test('a verified spiff says what it requires', () => {
    const p = plan({
      basis: 'item_count', rate_kind: 'per_unit', rate: 30, items: ['IR- Gold'],
      verify_source: 'invoice', min_price: 390, exclude_renewals: true,
    })
    const s = describeRule(p)
    assert.ok(s.includes('only counts with a matching invoice'), s)
    assert.ok(s.includes('$390'), s)
    assert.ok(s.includes('not renewals'), s)
  })
  test('an unverified spiff makes no such claim', () => {
    const p = plan({ basis: 'item_count', rate_kind: 'per_unit', rate: 25, items: ['IRR'] })
    assert.ok(!describeRule(p).includes('invoice'), describeRule(p))
  })
})
