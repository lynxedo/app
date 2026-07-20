import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripeConfigured } from '@/lib/billing/stripe'
import { reportUsage } from '@/lib/billing/usage-report'

// Called by the VPS cron (prod = live mode, staging = test mode), e.g. hourly:
//   curl -s -X POST https://lynxedo.com/api/billing/usage/report -H "x-cron-secret: $CRON_SECRET"
//
// One tick reports each subscribed tenant's accrued metered usage (call minutes, texts,
// AI-receptionist minutes) to its Stripe Billing Meter since the last watermark. The very
// first time a (tenant, meter) pair is seen it is watermarked but not billed, so usage is
// only ever counted from activation forward — never back-billed.
//
// Cron-secret gated (same mechanism as /api/drip/process). HOLDs with 503 when Stripe
// isn't configured for this env, so an env-unset box degrades gracefully.

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 503 })
  }

  try {
    const summary = await reportUsage(createAdminClient())
    return NextResponse.json(summary)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ configured: stripeConfigured() })
}
