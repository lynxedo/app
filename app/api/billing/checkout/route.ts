import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured } from '@/lib/billing/stripe'
import { getBillingMode } from '@/lib/billing/catalog'
import { getOrCreateStripeCustomer } from '@/lib/billing/subscription'

// Start a Stripe Checkout session for a tenant to subscribe. Company-admin only.
// The base plan is always included; the caller passes any à-la-carte module keys.
// A 14-day trial is attached and the resulting subscription is tagged with the
// company_id + mode so the webhook can attribute it back.
//
// Body: { feature_keys?: string[] }  (billable module keys; base is auto-added)
// Response: { url: string | null, missing: string[] }  — `missing` = requested keys
//           we couldn't add (unknown / inactive / base / no price id for this mode).

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://lynxedo.com'

export async function POST(request: Request) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { companyId, role } = auth
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 503 })
  }

  const body = (await request.json().catch(() => null)) as { feature_keys?: string[] } | null
  const requested = Array.isArray(body?.feature_keys)
    ? body!.feature_keys.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
    : []

  const mode = getBillingMode()
  const priceCol = mode === 'live' ? 'stripe_price_id_live' : 'stripe_price_id_test'
  const meteredPriceCol =
    mode === 'live' ? 'stripe_metered_price_id_live' : 'stripe_metered_price_id_test'
  const admin = createAdminClient()

  // Base plan — always the first line item.
  const { data: baseRow } = await admin
    .from('billing_catalog')
    .select(`feature_key, ${priceCol}`)
    .eq('is_base', true)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()

  const basePriceId: string | null = baseRow ? (baseRow as any)[priceCol] : null
  if (!baseRow || !basePriceId) {
    return NextResponse.json(
      { error: 'Base plan is not configured for billing yet. Run the Stripe sync first.' },
      { status: 400 },
    )
  }

  const baseFeatureKey = (baseRow as any).feature_key as string
  // Metered prices take NO quantity (Stripe rejects it), so quantity is optional here.
  const lineItems: Array<{ price: string; quantity?: number }> = [{ price: basePriceId, quantity: 1 }]
  const missing: string[] = []

  // Requested modules — must be active, non-base, and have a price id for this mode.
  const uniqueRequested = [...new Set(requested)].filter((k) => k !== baseFeatureKey)
  for (const key of uniqueRequested) {
    const { data: feat } = await admin
      .from('billing_catalog')
      .select(`feature_key, is_base, active, metered, ${priceCol}, ${meteredPriceCol}`)
      .eq('feature_key', key)
      .maybeSingle()
    const priceId: string | null = feat ? (feat as any)[priceCol] : null
    if (!feat || feat.active !== true || feat.is_base === true || !priceId) {
      missing.push(key)
      continue
    }
    // Flat base price for the module.
    lineItems.push({ price: priceId, quantity: 1 })
    // Metered module → ALSO add its usage price (no quantity), so it bills flat + usage.
    const meteredPriceId: string | null = (feat as any)[meteredPriceCol] ?? null
    if ((feat as any).metered === true && meteredPriceId) {
      lineItems.push({ price: meteredPriceId })
    }
  }

  try {
    const customer = await getOrCreateStripeCustomer(admin, companyId, mode)
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: lineItems,
      subscription_data: {
        trial_period_days: 14,
        metadata: { company_id: companyId, mode },
      },
      metadata: { company_id: companyId, mode },
      success_url: `${APP_URL}/hub/billing?checkout=success`,
      cancel_url: `${APP_URL}/hub/billing?checkout=cancel`,
    })
    return NextResponse.json({ url: session.url, missing })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
