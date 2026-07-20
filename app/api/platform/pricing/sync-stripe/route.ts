import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePlatformAdmin } from '@/lib/platform-auth'
import { syncCatalogToStripe } from '@/lib/billing/provisioning'
import { stripeConfigured } from '@/lib/billing/stripe'
import { logPlatformAction } from '@/lib/billing/audit'

// Platform super-admin action: mirror the billing catalog into Stripe (Products +
// recurring Prices) for the current env's mode. Cross-company — gated by the platform
// admin capability, not a tenant's own admin role.

// POST — run the catalog → Stripe sync. Returns { result: { synced, skipped, mode } }.
export async function POST() {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 503 })
  }

  const admin = createAdminClient()
  try {
    const result = await syncCatalogToStripe(admin)
    await logPlatformAction(admin, gate.userId, 'sync_stripe', null, result)
    return NextResponse.json({ result })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
