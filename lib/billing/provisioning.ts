// Catalog → Stripe provisioning (Track 5, M2).
//
// Mirrors the platform pricing catalog (billing_catalog) into Stripe as Products +
// recurring monthly USD Prices, for the CURRENT env's billing mode (test on staging,
// live on prod). Because Stripe Prices are immutable, a price change means minting a
// NEW price and archiving the old one — the catalog row stores the current price id
// per mode (stripe_price_id_test / stripe_price_id_live).
//
// All reads/writes use the service-role admin client (billing_catalog has RLS with no
// policies). The sweep is idempotent and resilient: each feature is wrapped in its own
// try/catch so one bad row can never abort the rest.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BillingMode } from './types'
import { getStripe } from './stripe'
import { getBillingMode } from './catalog'

type Admin = SupabaseClient<any, any, any>

// Which catalog column holds the Stripe price id for a given mode.
const PRICE_COL: Record<BillingMode, 'stripe_price_id_test' | 'stripe_price_id_live'> = {
  test: 'stripe_price_id_test',
  live: 'stripe_price_id_live',
}

/**
 * Sync every active, billable catalog feature into Stripe for the current mode.
 *
 * Billable = is_base OR (not included_in_base). For each such feature we ensure a
 * Stripe Product exists (creating one named after the label, tagged with feature_key)
 * and a recurring monthly USD Price matching default_price_cents. A new Price is minted
 * when the mode's stored price id is null OR its unit_amount no longer matches; the
 * previous price is then archived.
 *
 * Returns counts + the mode it ran against. Never throws for a single feature failure —
 * those are counted as skipped.
 */
export async function syncCatalogToStripe(
  admin: Admin,
): Promise<{ synced: number; skipped: number; mode: BillingMode }> {
  const mode = getBillingMode()
  const priceCol = PRICE_COL[mode]
  const stripe = getStripe()

  const { data, error } = await admin.from('billing_catalog').select('*').eq('active', true)
  if (error) throw new Error(error.message)

  const features = (data ?? []) as any[]
  let synced = 0
  let skipped = 0

  for (const f of features) {
    try {
      // Only billable features get a Stripe product/price.
      const billable = f.is_base === true || f.included_in_base === false
      if (!billable) {
        skipped++
        continue
      }

      // Explicitly skip zero/negative-priced features that are folded into the base and
      // are not the base row itself — there is nothing to charge for separately.
      if ((f.default_price_cents ?? 0) <= 0 && f.included_in_base === true && f.is_base !== true) {
        skipped++
        continue
      }

      // A Stripe Price needs a valid non-negative integer amount. Guard against bad data.
      const amount = f.default_price_cents
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
        skipped++
        continue
      }

      // 1) Ensure a Stripe Product.
      let productId: string | null = f.stripe_product_id ?? null
      if (!productId) {
        const product = await stripe.products.create({
          name: f.label,
          metadata: { feature_key: f.feature_key },
        })
        productId = product.id
        await admin
          .from('billing_catalog')
          .update({ stripe_product_id: productId, updated_at: new Date().toISOString() })
          .eq('feature_key', f.feature_key)
      }

      // 2) Ensure a recurring monthly USD Price for `amount`.
      const existingPriceId: string | null = f[priceCol] ?? null
      let needNew = !existingPriceId
      if (existingPriceId) {
        try {
          const existing = await stripe.prices.retrieve(existingPriceId)
          if (existing.unit_amount !== amount) needNew = true
        } catch {
          // Stored id is stale / was deleted upstream — mint a fresh one.
          needNew = true
        }
      }

      if (needNew) {
        const price = await stripe.prices.create({
          product: productId,
          currency: 'usd',
          unit_amount: amount,
          recurring: { interval: 'month' },
          metadata: { feature_key: f.feature_key },
        })
        await admin
          .from('billing_catalog')
          .update({ [priceCol]: price.id, updated_at: new Date().toISOString() })
          .eq('feature_key', f.feature_key)

        // Archive the superseded price — Stripe Prices are immutable, so the old one is
        // deactivated rather than edited. Best-effort: a failure here never fails the sync.
        if (existingPriceId) {
          try {
            await stripe.prices.update(existingPriceId, { active: false })
          } catch {
            /* best effort */
          }
        }
      }

      synced++
    } catch {
      // Resilient: one bad feature never aborts the sweep.
      skipped++
    }
  }

  return { synced, skipped, mode }
}
