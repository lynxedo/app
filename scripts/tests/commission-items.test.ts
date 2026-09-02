/* The verified spiff: which counted units are real sales.
 *
 * ⚠⚠ THE FIXTURE IS AUGUST 2026'S ACTUAL LEAD TRACKER AND ACTUAL INVOICES. Four
 * "IR - Gold" rows were sold in the month; the engine paid a $30 spiff for two of them
 * and only one was a sale. Each row below carries the invoice evidence the database
 * really returns for it, so a regression here is a regression in somebody's pay.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { type CommissionPlan, PLAN_DEFAULTS, payout } from '../../lib/reports/commission'
import { tallyItems, unitRejection } from '../../lib/scoreboards/widgets/commission'
import type { LeadItemUnit, LeadItemsRow } from '../../lib/scoreboards/widgets/sources'

function plan(over: Partial<CommissionPlan>): CommissionPlan {
  return {
    id: 'p', employee_id: 'e', label: 'Gold Sales',
    basis: 'item_count', rate_kind: 'per_unit', rate: 30,
    tiers: null, threshold: null, cap: null, line_prefix: null,
    items: ['IR- Gold'], active: true, sort_order: 0,
    ...PLAN_DEFAULTS,
    ...over,
  }
}

/** Both Gold plans as the migration sets them. */
const VERIFIED = plan({ verify_source: 'invoice', min_price: 390, exclude_renewals: true })

function unit(over: Partial<LeadItemUnit>): LeadItemUnit {
  return {
    lead_id: 'l', value: 'IR - Gold', salesperson: 'Josh', client: 'someone',
    sold_date: '2026-08-31', matched_client: true,
    invoice_price: 400, invoice_number: '0000', prior_history: false,
    ...over,
  }
}

/* August 2026, exactly as the book holds it. */
const DAVID_PARKER = unit({
  lead_id: 'lead-parker', salesperson: 'Josh', client: 'david e parker',
  sold_date: '2026-08-31', invoice_price: 400, invoice_number: '5847', prior_history: false,
})
/* ⚠ The row that paid Lucas $30 wrongly. Her only August Gold invoices are $0.00
 * included member visits (5636, 5713); her real Gold was invoice 4406 in April, paid
 * to another rep. Both guards catch her, which is deliberate belt-and-braces. */
const KASSY_BROCK = unit({
  lead_id: 'lead-brock', salesperson: 'Lucas', client: 'kassy brock',
  sold_date: '2026-08-11', invoice_price: null, invoice_number: null, prior_history: true,
})
/* Kathryn's two — neither is backed by a qualifying invoice. She holds no plan, but
 * they must not be creditable to anyone. */
const DEREK_CARSON = unit({
  lead_id: 'lead-carson', salesperson: 'Kathryn', client: 'derek carson',
  sold_date: '2026-08-07', invoice_price: null, invoice_number: null, prior_history: false,
})
const JORDAN_REAL = unit({
  lead_id: 'lead-real', salesperson: 'Kathryn', client: 'jordan real',
  sold_date: '2026-08-19', invoice_price: 205, invoice_number: '5734', prior_history: false,
})

const AUG: LeadItemsRow = {
  basis: 'sold', start: '2026-08-01', end: '2026-08-31', stages: ['closed_won'],
  // ⚠ `rows` is the OLD aggregate, kept so an unverified rule still reads it.
  rows: [{ value: 'IR - Gold', salesperson: 'Josh', leads: 1 },
         { value: 'IR - Gold', salesperson: 'Lucas', leads: 1 },
         { value: 'IR - Gold', salesperson: 'Kathryn', leads: 2 }],
  units: [DEREK_CARSON, KASSY_BROCK, JORDAN_REAL, DAVID_PARKER],
  coverage: {
    leads: 4, no_service: 0, multi_service: 0, no_salesperson: 0,
    unmatched_clients: 0, earliest: '2026-01-02', latest: '2026-08-31',
  },
}

describe('a renewal is not a sale', () => {
  test('a customer who already had Gold is excluded', () => {
    const why = unitRejection(VERIFIED, unit({ invoice_price: 400, prior_history: true }))
    assert.equal(why, 'that customer already had it — a renewal, not a new sale')
  })
  test('…and is NOT excluded when the rule does not ask for it', () => {
    // Ten of August's eleven $400 Gold invoices were renewals. A rule that has not
    // opted in must keep paying exactly what it paid before.
    const lenient = plan({ verify_source: 'invoice', min_price: 390, exclude_renewals: false })
    assert.equal(unitRejection(lenient, unit({ invoice_price: 400, prior_history: true })), null)
  })
  test('a genuinely new member still counts', () => {
    assert.equal(unitRejection(VERIFIED, DAVID_PARKER), null)
  })
})

describe('a tracker row with no matching invoice is excluded', () => {
  test('no invoice at all in the period', () => {
    assert.equal(
      unitRejection(VERIFIED, unit({ invoice_price: null, invoice_number: null })),
      'no invoice in this period backs it',
    )
  })
  test('a $0 included member visit is not a sale', () => {
    const why = unitRejection(VERIFIED, unit({ invoice_price: 0 }))
    assert.ok(why?.includes('under the $390'), why ?? 'expected a price rejection')
  })
  test('a $100 single prepaid visit is not a sale', () => {
    assert.ok(unitRejection(VERIFIED, unit({ invoice_price: 100 }))?.includes('under the $390'))
  })
  test('a $205 part-year plan and a $250.20 prorated one are not sales', () => {
    assert.ok(unitRejection(VERIFIED, unit({ invoice_price: 205 }))?.includes('under the $390'))
    assert.ok(unitRejection(VERIFIED, unit({ invoice_price: 250.20 }))?.includes('under the $390'))
  })
  test('⚠ the “- T1” suffix is NOT the discriminator — price is', () => {
    /* Invoice 5847, August's one real sale, is an "IR - Irrigation Service Plan
     * Gold - T1" line at $400, while a $100 "- T1" is a single prepaid visit. Anything
     * keyed on the suffix would have rejected the sale and paid the visit. */
    assert.equal(unitRejection(VERIFIED, unit({ invoice_price: 400 })), null)
    assert.ok(unitRejection(VERIFIED, unit({ invoice_price: 100 })) !== null)
  })
  test('a name that matches no customer file is named, not silently dropped', () => {
    const why = unitRejection(VERIFIED, unit({ matched_client: false }))
    assert.ok(why?.includes('no customer file matches'), why ?? 'expected a match rejection')
  })
})

describe('August 2026, end to end', () => {
  test('Josh: 1 verified unit = $30.00', () => {
    const t = tallyItems(VERIFIED, AUG, 'Josh')
    assert.equal(t.counted, 1)
    assert.deepEqual(t.rejected, [])
    assert.equal(payout(VERIFIED, t.counted).paid, 30)
  })

  test('Lucas: the Kassy Brock row no longer counts = $0.00', () => {
    const lucas = { ...VERIFIED, employee_id: 'lucas' }
    const t = tallyItems(lucas, AUG, 'Lucas')
    assert.equal(t.counted, 0)
    assert.equal(t.rejected.length, 1)
    assert.equal(payout(lucas, t.counted).paid, 0)
  })

  test('Lucas: the reason is stated, so $0 does not read as a broken card', () => {
    const t = tallyItems(VERIFIED, AUG, 'Lucas')
    assert.match(t.rejected[0], /no invoice in this period backs it|already had it/)
  })

  test('BEFORE the fix both were paid $30 — that is the bug being closed', () => {
    // The unverified rule is the old behaviour, and it still reads the old aggregate.
    const old = plan({})
    assert.equal(tallyItems(old, AUG, 'Josh').counted, 1)
    assert.equal(tallyItems(old, AUG, 'Lucas').counted, 1)
    assert.equal(payout(old, 1).paid, 30)
  })

  test('Kathryn’s two rows are creditable to nobody', () => {
    assert.equal(tallyItems(VERIFIED, AUG, 'Kathryn').counted, 0)
  })

  test('Rachio: nothing sold, so nothing paid', () => {
    const rachio = plan({ label: 'Rachio Sales', items: ['IR - Rachio'] })
    assert.equal(tallyItems(rachio, AUG, 'Josh').counted, 0)
    assert.equal(tallyItems(rachio, AUG, 'Lucas').counted, 0)
  })
})

describe('an unverified rule is untouched — Mike must not move', () => {
  test('Mike’s IR SVC rule keeps reading the old aggregate', () => {
    const irsvc = plan({
      label: 'IR SVC', rate: 25,
      items: ['IRR', 'Irrigation – inspection, repair, and/or new install (full irrigation visit starting with a $125 inspection)'],
    })
    assert.equal(irsvc.verify_source, null)
    assert.equal(tallyItems(irsvc, AUG, 'Mike').counted, 0)
    assert.deepEqual(tallyItems(irsvc, AUG, 'Mike').rejected, [])
  })
  test('an unverified rule never rejects a unit, whatever the evidence says', () => {
    assert.equal(unitRejection(plan({}), unit({ invoice_price: null, prior_history: true })), null)
  })
  test('item names fold the same way they always did', () => {
    // 'IR- Gold' on the plan must still reach 'IR - Gold' on the tracker row.
    assert.equal(tallyItems(VERIFIED, AUG, 'Josh').counted, 1)
    const spaced = plan({ items: ['IR - Gold'], verify_source: 'invoice', min_price: 390, exclude_renewals: true })
    assert.equal(tallyItems(spaced, AUG, 'Josh').counted, 1)
  })
  test('a row listing the same service twice pays once', () => {
    const dup: LeadItemsRow = { ...AUG, units: [DAVID_PARKER, { ...DAVID_PARKER }] }
    assert.equal(tallyItems(VERIFIED, dup, 'Josh').counted, 1)
  })
})
