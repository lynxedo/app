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
  type CommissionPlan, COMMISSION_PERIODS, PLAN_DEFAULTS, TIER_MODES,
  describeRule, payout, payoutOverPeriods, planCoversPeriod, tieredGross,
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

/**
 * Josh's four bonus weeks of August 2026 under the Thursday rule, from the live book.
 *
 * ⚠ NOT the same four weeks as before. Under the old anchor rule August began Jul 27;
 * under the Thursday rule that week has five of its days in July, so it is JULY's W5
 * and August starts Aug 3. The week of Aug 24 — which the old rule left in no month at
 * all — is August's W4.
 */
const JOSH_AUG = [
  { key: 'W1', label: 'W1 Aug 3 – Aug 9', amount: 4862.25 },
  { key: 'W2', label: 'W2 Aug 10 – Aug 16', amount: 3188.08 },
  { key: 'W3', label: 'W3 Aug 17 – Aug 23', amount: 1821.90 },
  { key: 'W4', label: 'W4 Aug 24 – Aug 30', amount: 1743.20 },
]

/** And July's five, so the week that moved can be checked on both sides. */
const JOSH_JUL = [
  { key: 'W1', label: 'W1 Jun 29 – Jul 5', amount: 0 },
  { key: 'W2', label: 'W2 Jul 6 – Jul 12', amount: 0 },
  { key: 'W3', label: 'W3 Jul 13 – Jul 19', amount: 2752.03 },
  { key: 'W4', label: 'W4 Jul 20 – Jul 26', amount: 1965.00 },
  { key: 'W5', label: 'W5 Jul 27 – Aug 2', amount: 4019.03 },
]

describe('bonus weeks — the Thursday rule', () => {
  test('a week belongs to the month holding its Thursday', () => {
    /* Ben's rule was "whichever month has more days of the week". A week is SEVEN
     * days, so it can never tie, and the majority month is always the one holding the
     * 4th day — the Thursday. These two cases are the ones he named. */
    // Week Mon Jul 27 – Sun Aug 2: five days in July, two in August → JULY.
    assert.equal(commissionWeeks(2026, 7).at(-1)?.start, '2026-07-27')
    assert.equal(commissionWeeks(2026, 8).some(w => w.start === '2026-07-27'), false)
    // Week Mon Aug 31 – Sun Sep 6: one day in August, six in September → SEPTEMBER.
    assert.equal(commissionWeeks(2026, 9)[0].start, '2026-08-31')
    assert.equal(commissionWeeks(2026, 8).some(w => w.start === '2026-08-31'), false)
  })

  test('August 2026 is Aug 3 – Aug 30, four weeks', () => {
    assert.deepEqual(
      commissionWeeks(2026, 8).map(w => [w.start, w.end]),
      [['2026-08-03', '2026-08-09'], ['2026-08-10', '2026-08-16'],
       ['2026-08-17', '2026-08-23'], ['2026-08-24', '2026-08-30']],
    )
  })

  test('July 2026 has FIVE bonus weeks — never assume four', () => {
    const jul = commissionWeeks(2026, 7)
    assert.equal(jul.length, 5)
    assert.equal(jul[0].start, '2026-06-29')
    assert.equal(jul.at(-1)?.end, '2026-08-02')
  })

  test('2026 runs 5,4,4,5,4,4,5,4,4,5,4,5 weeks', () => {
    const counts = Array.from({ length: 12 }, (_, i) => commissionWeeks(2026, i + 1).length)
    assert.deepEqual(counts, [5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 5])
    /* 53, not 52: 2026's bonus months run from Mon Dec 29 2025 (January's W1) through
     * Sun Jan 3 2027 (December's W5) — 371 days. A calendar year has 52 whole weeks
     * plus a remainder, and the Thursday rule assigns that remainder to a real month
     * rather than dropping it, which is the entire point. */
    assert.equal(counts.reduce((a, b) => a + b, 0), 53)
    assert.equal(commissionWeeks(2026, 1)[0].start, '2025-12-29')
    assert.equal(commissionWeeks(2026, 12).at(-1)?.end, '2027-01-03')
  })

  test('⚠⚠ THE WEEKS TILE: no gaps and no overlaps, three years running', () => {
    /* The whole reason this rule replaced the old one. Under "W1 = last Monday on or
     * before the 1st, then exactly four weeks", Aug 24–30 2026 was in NO bonus month —
     * four months a year, with real completed work in them. This asserts the property
     * directly: consecutive months must abut exactly, day after day. */
    let prevEnd: string | null = null
    for (const y of [2025, 2026, 2027]) {
      for (let m = 1; m <= 12; m++) {
        const wks = commissionWeeks(y, m)
        // Every week is exactly 7 days and starts on a Monday.
        for (const w of wks) {
          const ms = Date.parse(`${w.start}T00:00:00Z`)
          const me = Date.parse(`${w.end}T00:00:00Z`)
          assert.equal((me - ms) / 86400000, 6, `${w.start} is not a 7-day week`)
          assert.equal(new Date(ms).getUTCDay(), 1, `${w.start} is not a Monday`)
        }
        // Weeks within the month are contiguous.
        for (let i = 1; i < wks.length; i++) {
          const gap = (Date.parse(`${wks[i].start}T00:00:00Z`) - Date.parse(`${wks[i - 1].end}T00:00:00Z`)) / 86400000
          assert.equal(gap, 1, `gap inside ${y}-${m} at W${i + 1}`)
        }
        // And month N starts the day after month N-1 ends. This is the fixed bug.
        if (prevEnd) {
          const monthGap: number =
            (Date.parse(`${wks[0].start}T00:00:00Z`) - Date.parse(`${prevEnd}T00:00:00Z`)) / 86400000
          assert.equal(monthGap, 1, `${y}-${m} does not abut the previous month`)
        }
        prevEnd = wks[wks.length - 1].end
      }
    }
  })

  test('the window’s END month decides the bonus month', () => {
    const cm = commissionMonth({ start: '2026-08-01', end: '2026-08-31', label: '', phrase: '' })
    assert.equal(cm.month, 8)
    assert.equal(cm.start, '2026-08-03')
    assert.equal(cm.end, '2026-08-30')
    assert.equal(cm.weeks.length, 4)
  })

  test('buckets are encoded for the RPC, however many there are', () => {
    assert.equal(
      encodeBuckets(commissionWeeks(2026, 8)),
      'W1:2026-08-03:2026-08-09,W2:2026-08-10:2026-08-16,W3:2026-08-17:2026-08-23,W4:2026-08-24:2026-08-30',
    )
    // A five-week month emits five — the RPC counts what it is handed.
    assert.equal(encodeBuckets(commissionWeeks(2026, 7)).split(',').length, 5)
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
  test('Josh’s August under the Thursday rule = $24.31', () => {
    const p = plan({ rate_kind: 'tiered', tiers: JOSH_TIERS, period: 'week', tier_mode: 'flat' })
    const out = payoutOverPeriods(p, JOSH_AUG)
    assert.deepEqual(out.parts.map(x => x.paid), [24.31, 0, 0, 0])
    assert.equal(out.paid, 24.31)
  })

  test('…and the week that moved to July pays there instead — nothing is lost', () => {
    /* ⚠ The reassurance that matters about the week-boundary fix: it MOVES money, it
     * does not create or destroy it. Jul 27–Aug 2 was August's W1 under the old anchor
     * rule and is July's W5 under the Thursday rule. Old: Jul $0 + Aug $34.36. New:
     * Jul $10.05 + Aug $24.31. Same $34.36 across the two months. */
    const p = plan({ rate_kind: 'tiered', tiers: JOSH_TIERS, period: 'week', tier_mode: 'flat' })
    const jul = payoutOverPeriods(p, JOSH_JUL)
    assert.equal(jul.paid, 10.05)
    assert.equal(jul.parts.at(-1)?.paid, 10.05)   // W5, the week that moved
    const aug = payoutOverPeriods(p, JOSH_AUG)
    assert.equal(Math.round((jul.paid + aug.paid) * 100) / 100, 34.36)
  })

  test('the week the OLD rule lost is now paid — W4 Aug 24–30 exists at all', () => {
    // $1,743.20 of completed work that belonged to no bonus month before. Under
    // Josh's bands it still pays nothing (under his $4,000 floor) — but it is counted,
    // and on a bigger week it would pay.
    const p = plan({ rate_kind: 'tiered', tiers: JOSH_TIERS, period: 'week', tier_mode: 'flat' })
    const out = payoutOverPeriods(p, JOSH_AUG)
    assert.equal(out.parts.length, 4)
    assert.equal(out.parts[3].amount, 1743.20)
    // …and if that week had been a good one, it would now pay rather than vanish.
    const bigger = payoutOverPeriods(p, [...JOSH_AUG.slice(0, 3), { key: 'W4', label: 'W4', amount: 7200 }])
    assert.equal(bigger.parts[3].paid, 108)
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
    assert.equal(Math.round(total * 100) / 100, 11615.43)
    // $11,615.43 priced as ONE figure clears the 3% band: $348.46 against $24.31 owed.
    assert.equal(payout(monthly, total).paid, 348.46)
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

describe('no user-facing text may claim a fixed number of bonus weeks', () => {
  /* ⚠⚠ THIS GUARDS A TRAP THIS FEATURE FELL INTO TWICE IN ONE DAY. A caveat is a claim
   * about the arithmetic, so changing the arithmetic turns it into a wrong number
   * written in prose — and prose does not fail a type check. Both times the offending
   * strings were caught only by grepping the BUILT bundle for text that should have
   * disappeared. These assertions move that check earlier.
   *
   * The banned phrases all assert the OLD rule: exactly four weeks, or an anchor on the
   * last Monday before the 1st. A month now has four OR five, decided by Thursdays. */
  const BANNED = [
    /last Monday on or before/i,
    /\bW1[–\-]W4\b/,
    /\bfour bonus weeks\b/i,
    /\bthe four weeks\b/i,
    /28 days/,
  ]

  function assertClean(label: string, text: string) {
    for (const re of BANNED) {
      assert.ok(!re.test(text), `${label} still claims the old four-week rule: ${re} in "${text}"`)
    }
  }

  test('the period options an admin picks from say nothing about four weeks', () => {
    for (const o of COMMISSION_PERIODS) {
      assertClean(`period "${o.key}" label`, o.label)
      assertClean(`period "${o.key}" hint`, o.hint)
    }
  })

  test('the rule sentence on the card says nothing about four weeks', () => {
    for (const period of ['month', 'commission_weeks', 'week'] as const) {
      const p = plan({ basis: 'revenue_produced', rate_kind: 'tiered', tiers: JOSH_TIERS, period, tier_mode: 'flat' })
      assertClean(`describeRule(${period})`, describeRule(p))
    }
    const t = plan({ basis: 'rev_per_hour', rate_kind: 'target_tiered', tiers: [{ from: 85, rate: 95 }], period: 'commission_weeks' })
    assertClean('describeRule(target, commission_weeks)', describeRule(t))
  })

  test('the tier-mode options are clean too', () => {
    for (const o of TIER_MODES) {
      assertClean(`tier mode "${o.key}" label`, o.label)
      assertClean(`tier mode "${o.key}" hint`, o.hint)
    }
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
