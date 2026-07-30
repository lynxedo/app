// Tenant subscription <-> Stripe reconciliation (Track 5, M2).
//
// Two responsibilities:
//   1. getOrCreateStripeCustomer — the one Stripe Customer per (company, mode).
//   2. syncSubscriptionFromStripe — project a Stripe Subscription onto our
//      company_subscription + company_module_subscription rows for a mode.
//
// Everything runs through the service-role admin client (these tables are managed by
// the platform, and syncing from a webhook has no user session). All timestamps are
// stored as ISO strings.
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { getStripe, stripeConfigured } from './stripe'
import { getOrCreatePercentCoupon } from './discounts'
import type { BillingMode, SubscriptionStatus } from './types'

type Admin = SupabaseClient<any, any, any>

// Epoch-seconds → ISO string (null-safe).
function epochToIso(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : null
}

// Map every Stripe subscription status onto our narrower enum. The five statuses the
// enum shares pass through; the rest fold onto the closest lifecycle state.
const STATUS_MAP: Record<string, SubscriptionStatus> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  incomplete: 'incomplete',
  incomplete_expired: 'canceled', // terminal — treat as canceled
  unpaid: 'past_due', // dunning failed — closest is past_due
  paused: 'past_due', // billing paused — treat as not-current
}

function mapStatus(status: string): SubscriptionStatus {
  return STATUS_MAP[status] ?? 'incomplete'
}

/**
 * Return the Stripe Customer id for (company, mode), creating one if absent.
 *
 * On create the customer is named after the company and tagged with {company_id, mode},
 * and the company_subscription row is seeded (status stays 'none' until a real
 * subscription exists). An existing row is updated in place (never clobbering its
 * status), so calling this before checkout is safe and idempotent.
 */
export async function getOrCreateStripeCustomer(
  admin: Admin,
  companyId: string,
  mode: BillingMode,
): Promise<string> {
  const { data: sub } = await admin
    .from('company_subscription')
    .select('stripe_customer_id')
    .eq('company_id', companyId)
    .eq('mode', mode)
    .maybeSingle()

  if (sub?.stripe_customer_id) return sub.stripe_customer_id

  const { data: company } = await admin
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .maybeSingle()

  const customer = await getStripe().customers.create({
    name: company?.name ?? undefined,
    metadata: { company_id: companyId, mode },
  })

  if (sub) {
    // Row exists but has no customer id yet — attach it, leave status untouched.
    await admin
      .from('company_subscription')
      .update({ stripe_customer_id: customer.id })
      .eq('company_id', companyId)
      .eq('mode', mode)
  } else {
    // No row yet — seed one; no subscription exists so status is 'none'.
    await admin.from('company_subscription').insert({
      company_id: companyId,
      mode,
      stripe_customer_id: customer.id,
      status: 'none',
      cancel_at_period_end: false,
    })
  }

  return customer.id
}

/**
 * Project a Stripe Subscription onto our DB for the given mode.
 *
 * Resolves the tenant via sub.metadata.company_id, falling back to a lookup by
 * stripe_customer_id. Upserts company_subscription (status/ids/trial/period/cancel
 * flag) then reconciles company_module_subscription: every line item whose price maps
 * to a catalog feature becomes an active module row; any previously-active module NOT
 * present in the current items is deactivated.
 *
 * Note: in recent Stripe API versions `current_period_end` lives on the subscription
 * ITEM, not the top-level subscription — we read it from the items (max across items).
 */
export async function syncSubscriptionFromStripe(
  admin: Admin,
  sub: Stripe.Subscription,
  mode: BillingMode,
): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : (sub.customer?.id ?? null)

  // Prefer the company_id we stamped in metadata; fall back to the customer mapping.
  let companyId: string | null =
    (sub.metadata?.company_id as string | undefined)?.trim() || null
  if (!companyId && customerId) {
    const { data: existing } = await admin
      .from('company_subscription')
      .select('company_id')
      .eq('mode', mode)
      .eq('stripe_customer_id', customerId)
      .maybeSingle()
    companyId = existing?.company_id ?? null
  }
  if (!companyId) return // can't attribute this subscription — nothing to write

  const items = sub.items?.data ?? []

  // Per-module discount overrides for this tenant (feature_key -> percent, >0 only).
  const { data: ovrRows } = await admin
    .from('company_billing_overrides')
    .select('feature_key, discount_percent')
    .eq('company_id', companyId)
  const discountByKey = new Map<string, number>()
  for (const o of (ovrRows ?? []) as Array<{ feature_key: string; discount_percent: number | null }>) {
    if (o.discount_percent != null && Number(o.discount_percent) > 0) {
      discountByKey.set(o.feature_key, Number(o.discount_percent))
    }
  }

  // current_period_end is per-item in current API versions; take the furthest.
  const periodEnds = items
    .map((it) => it.current_period_end)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  const periodEndEpoch = periodEnds.length ? Math.max(...periodEnds) : null

  await admin.from('company_subscription').upsert(
    {
      company_id: companyId,
      mode,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      status: mapStatus(sub.status),
      trial_ends_at: epochToIso(sub.trial_end),
      current_period_end: epochToIso(periodEndEpoch),
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
    },
    { onConflict: 'company_id,mode' },
  )

  // Reconcile module subscriptions against the live line items.
  const priceCol = mode === 'live' ? 'stripe_price_id_live' : 'stripe_price_id_test'
  const activeKeys = new Set<string>()

  for (const item of items) {
    const priceId = item.price?.id
    if (!priceId) continue

    const { data: feat } = await admin
      .from('billing_catalog')
      .select('feature_key, is_base')
      .eq(priceCol, priceId)
      .maybeSingle()
    const featureKey: string | undefined = feat?.feature_key
    if (!featureKey) continue // a price with no catalog mapping (e.g. legacy) is ignored

    // Reconcile this line item's per-module discount against the tenant's override.
    // Idempotent via item metadata: we stamp the applied percent, so the follow-on
    // subscription.updated event this write triggers finds it already-correct and skips
    // (no loop). Best-effort — a discount failure never blocks the module reconcile.
    const desiredPct = discountByKey.get(featureKey) ?? 0
    const currentPct = Number(item.metadata?.lynxedo_discount_pct ?? '') || 0
    if (desiredPct !== currentPct) {
      try {
        const params: Stripe.SubscriptionItemUpdateParams = {
          metadata: { ...(item.metadata ?? {}), lynxedo_discount_pct: String(desiredPct) },
          discounts:
            desiredPct > 0 ? [{ coupon: await getOrCreatePercentCoupon(desiredPct) }] : '',
        }
        await getStripe().subscriptionItems.update(item.id, params)
      } catch (e) {
        console.error('[billing] discount reconcile failed', featureKey, (e as Error).message)
      }
    }

    if (feat?.is_base) continue // base is tracked via company_subscription, not as a gated module

    activeKeys.add(featureKey)
    await admin.from('company_module_subscription').upsert(
      {
        company_id: companyId,
        feature_key: featureKey,
        mode,
        active: true,
        stripe_subscription_item_id: item.id,
      },
      { onConflict: 'company_id,feature_key,mode' },
    )
  }

  // Deactivate any module that used to be active but is no longer on the subscription.
  const { data: existingModules } = await admin
    .from('company_module_subscription')
    .select('feature_key')
    .eq('company_id', companyId)
    .eq('mode', mode)
    .eq('active', true)

  for (const m of (existingModules ?? []) as Array<{ feature_key: string }>) {
    if (!activeKeys.has(m.feature_key)) {
      await admin
        .from('company_module_subscription')
        .update({ active: false })
        .eq('company_id', companyId)
        .eq('feature_key', m.feature_key)
        .eq('mode', mode)
    }
  }
}

/**
 * Re-pull a company's live Stripe subscription and re-run the sync, so a just-saved
 * per-module discount override is pushed to Stripe immediately instead of waiting for the
 * next subscription event. Best-effort + safe: no-ops when Stripe is unconfigured (e.g.
 * dark on prod) or the company has no subscription for this mode.
 */
export async function reapplyCompanySubscriptionDiscounts(
  admin: Admin,
  companyId: string,
  mode: BillingMode,
): Promise<void> {
  if (!stripeConfigured()) return
  const { data: sub } = await admin
    .from('company_subscription')
    .select('stripe_subscription_id')
    .eq('company_id', companyId)
    .eq('mode', mode)
    .maybeSingle()
  const subId = sub?.stripe_subscription_id as string | null | undefined
  if (!subId) return
  const stripeSub = await getStripe().subscriptions.retrieve(subId)
  await syncSubscriptionFromStripe(admin, stripeSub, mode)
}
