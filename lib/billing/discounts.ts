// Per-module discount coupons (Track 5 follow-up, 2026-07-30).
//
// A per-tenant, per-module discount is expressed as a percentage on
// company_billing_overrides.discount_percent. We realize it in Stripe as a percent-off
// coupon attached to that module's subscription LINE ITEM (see subscription.ts), so it
// comes off every invoice automatically.
//
// Coupons are REUSABLE: a single "15% off, forever" coupon is shared by every
// tenant/line discounted 15%, so we key each coupon on its percentage and create it
// lazily. Stripe's test and live environments are separate data namespaces, so no
// per-mode suffix is needed — the id space doesn't collide across modes.
import { getStripe } from './stripe'

// Deterministic coupon id for a given percent. discount_percent is numeric(5,2), so we
// key on hundredths (15 -> 1500, 12.5 -> 1250) to keep the id integer-safe and stable.
function couponIdForPercent(percent: number): string {
  return `lynxedo_pct_off_${Math.round(percent * 100)}`
}

/**
 * Get (or lazily create) the reusable percent-off coupon for `percent` and return its id.
 *
 * Idempotent and race-safe: retrieves by deterministic id first; on a miss, creates it;
 * if a concurrent caller won the create race, retrieves the now-existing coupon.
 */
export async function getOrCreatePercentCoupon(percent: number): Promise<string> {
  const id = couponIdForPercent(percent)
  const stripe = getStripe()

  try {
    const existing = await stripe.coupons.retrieve(id)
    if (existing && !(existing as { deleted?: boolean }).deleted) return existing.id
  } catch {
    // resource_missing — fall through to create.
  }

  try {
    const created = await stripe.coupons.create({
      id,
      percent_off: percent,
      duration: 'forever',
      name: `${percent}% off`,
      metadata: { lynxedo_managed: 'true' },
    })
    return created.id
  } catch {
    // Lost a create race (coupon exists now) — retrieve it.
    const again = await stripe.coupons.retrieve(id)
    return again.id
  }
}
