import { NextResponse, after } from 'next/server'
import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/billing/stripe'
import { syncSubscriptionFromStripe } from '@/lib/billing/subscription'
import type { BillingMode } from '@/lib/billing/types'

// Stripe webhook (Track 5, M2). Modeled on the Resend webhook: nodejs runtime, read the
// RAW body BEFORE any parsing, verify the signature, 503 while the secret is unset, ack
// 200 fast and do the DB work in after(). Handlers are idempotent (upserts) so Stripe's
// retries are harmless.
//
// Configure at cutover: add an endpoint in the Stripe dashboard pointing at
// https://lynxedo.com/api/billing/stripe-webhook for customer.subscription.created/
// updated/deleted, checkout.session.completed, invoice.payment_failed — then put its
// signing secret in the env as STRIPE_WEBHOOK_SECRET (whsec_…).

export const runtime = 'nodejs'

// GET — liveness / config probe.
export async function GET() {
  return NextResponse.json({ configured: Boolean(process.env.STRIPE_WEBHOOK_SECRET) })
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    // Not wired yet — be explicit rather than silently accepting unverified events.
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 })
  }

  const raw = await request.text()
  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(raw, signature, secret)
  } catch (e) {
    return NextResponse.json({ error: 'invalid_signature', detail: (e as Error).message }, { status: 400 })
  }

  // livemode tells us which of our two (test/live) DB rows this event applies to.
  const mode: BillingMode = event.livemode ? 'live' : 'test'

  // Ack immediately; reconcile after the response is sent.
  after(async () => {
    const admin = createAdminClient()
    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          // On delete the object still carries status='canceled', so a plain sync lands
          // the right terminal state.
          const sub = event.data.object as Stripe.Subscription
          await syncSubscriptionFromStripe(admin, sub, mode)
          break
        }
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session
          const subId =
            typeof session.subscription === 'string'
              ? session.subscription
              : (session.subscription?.id ?? null)
          if (subId) {
            const sub = await getStripe().subscriptions.retrieve(subId)
            await syncSubscriptionFromStripe(admin, sub, mode)
          }
          break
        }
        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice
          const customerId =
            typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer?.id ?? null)
          if (customerId) {
            await admin
              .from('company_subscription')
              .update({ status: 'past_due' })
              .eq('mode', mode)
              .eq('stripe_customer_id', customerId)
          }
          break
        }
        default:
          // Ignore all other event types.
          break
      }
    } catch (e) {
      console.error('[stripe-webhook] processing error', event.type, (e as Error).message)
    }
  })

  return NextResponse.json({ received: true })
}
