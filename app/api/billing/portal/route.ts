import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured } from '@/lib/billing/stripe'
import { getBillingMode } from '@/lib/billing/catalog'

// Open the Stripe Customer Portal for a tenant so they can manage their subscription
// (update payment method, cancel, view invoices). Company-admin only.
//
// Response: { url: string | null }

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://lynxedo.com'

export async function POST() {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { companyId, role } = auth
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 503 })
  }

  const mode = getBillingMode()
  const admin = createAdminClient()

  const { data: sub } = await admin
    .from('company_subscription')
    .select('stripe_customer_id')
    .eq('company_id', companyId)
    .eq('mode', mode)
    .maybeSingle()

  if (!sub?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing customer yet' }, { status: 400 })
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${APP_URL}/hub/billing`,
    })
    return NextResponse.json({ url: session.url })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
