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

// Which catalog column holds the METERED (usage-based) Stripe price id for a given mode.
const METERED_PRICE_COL: Record<
  BillingMode,
  'stripe_metered_price_id_test' | 'stripe_metered_price_id_live'
> = {
  test: 'stripe_metered_price_id_test',
  live: 'stripe_metered_price_id_live',
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

      // 3) Usage-based (metered) features: on top of the flat base price above, ensure a
      // Stripe Billing Meter (aggregating usage per-customer) and a per-mode metered Price
      // referencing it. A metered module ends up as TWO subscription line items at checkout:
      // the flat base price + this metered price. This whole block is inside the per-feature
      // try, so a metered failure folds into the skipped tally and retries next sweep.
      if (f.metered === true) {
        const eventName: string | null = f.meter_event_name ?? null

        // 3a) Ensure the account-wide Billing Meter (one per event_name).
        // ⚠ stripe_meter_id is a single (mode-agnostic) column: the first mode to sync
        // stores its meter id and both modes then reuse it. Meters ARE per-mode in Stripe,
        // so a live sync inheriting a test meter id would mint a live metered price against
        // a test meter and fail — acceptable while only test mode is provisioned (M4.5), but
        // a per-mode stripe_meter_id_{test,live} split is needed before live provisioning.
        let meterId: string | null = f.stripe_meter_id ?? null
        if (!meterId && eventName) {
          try {
            const meter = await stripe.billing.meters.create({
              display_name: f.label,
              event_name: eventName,
              default_aggregation: { formula: 'sum' },
              customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
              value_settings: { event_payload_key: 'value' },
            })
            meterId = meter.id
          } catch (err) {
            // A meter's event_name must be unique per account. If one already exists (e.g. a
            // prior sweep created it but crashed before storing the id), reuse it.
            const list = await stripe.billing.meters.list({ status: 'active', limit: 100 })
            const existingMeter = list.data.find((m) => m.event_name === eventName)
            if (!existingMeter) throw err
            meterId = existingMeter.id
          }
          await admin
            .from('billing_catalog')
            .update({ stripe_meter_id: meterId, updated_at: new Date().toISOString() })
            .eq('feature_key', f.feature_key)
        }

        // 3b) Ensure a metered Price for the current mode. Create when the mode's stored
        // metered price id is null OR its unit_amount no longer matches unit_price_cents.
        const unitPrice = f.unit_price_cents
        const validUnitPrice =
          typeof unitPrice === 'number' && Number.isFinite(unitPrice) && unitPrice >= 0
        if (meterId && validUnitPrice) {
          const meteredCol = METERED_PRICE_COL[mode]
          const existingMeteredId: string | null = f[meteredCol] ?? null
          let needNewMetered = !existingMeteredId
          if (existingMeteredId) {
            try {
              const existingMetered = await stripe.prices.retrieve(existingMeteredId)
              if (existingMetered.unit_amount !== unitPrice) needNewMetered = true
            } catch {
              needNewMetered = true
            }
          }

          if (needNewMetered) {
            const meteredPrice = await stripe.prices.create({
              product: productId,
              currency: 'usd',
              unit_amount: unitPrice,
              recurring: { interval: 'month', usage_type: 'metered', meter: meterId },
              metadata: { feature_key: f.feature_key, metered: 'true' },
            })
            await admin
              .from('billing_catalog')
              .update({ [meteredCol]: meteredPrice.id, updated_at: new Date().toISOString() })
              .eq('feature_key', f.feature_key)

            // Archive the superseded metered price (best-effort; never fails the sync).
            if (existingMeteredId) {
              try {
                await stripe.prices.update(existingMeteredId, { active: false })
              } catch {
                /* best effort */
              }
            }
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
