import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePlatformAdmin } from '@/lib/platform-auth'
import { upsertCompanyOverride, clearCompanyOverride, getBillingMode } from '@/lib/billing/catalog'
import { reapplyCompanySubscriptionDiscounts } from '@/lib/billing/subscription'
import { logPlatformAction } from '@/lib/billing/audit'

// Per-subscriber pricing overrides for one catalog feature (cross-company, platform
// super-admin only). Writes use the service-role admin client — company_billing_overrides
// is service-role only. The [key] path segment is the catalog feature_key.

// PUT — set/update an override.
// Body: { company_id, included_in_base_override, price_cents_override, discount_percent }.
// A null field means "inherit the catalog default" for that dimension (discount_percent
// null = no discount / full price). discount_percent must be in [0, 100].
export async function PUT(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const { key } = await params
  const body = (await request.json().catch(() => null)) as {
    company_id?: string
    included_in_base_override?: boolean | null
    price_cents_override?: number | null
    discount_percent?: number | null
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const companyId = typeof body.company_id === 'string' ? body.company_id.trim() : ''
  if (!companyId) return NextResponse.json({ error: 'company_id is required.' }, { status: 400 })

  // Normalize/validate the discount percentage: null (no discount) or a number in [0,100].
  let discountPercent: number | null = null
  if (body.discount_percent != null) {
    const n = Number(body.discount_percent)
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return NextResponse.json(
        { error: 'discount_percent must be a number between 0 and 100.' },
        { status: 400 },
      )
    }
    // Round to 2 decimals (matches the DB numeric(5,2)); treat exactly 0 as "no discount".
    discountPercent = n === 0 ? null : Math.round(n * 100) / 100
  }

  const admin = createAdminClient()
  try {
    const override = await upsertCompanyOverride(admin, key, companyId, {
      included_in_base_override: body.included_in_base_override ?? null,
      price_cents_override: body.price_cents_override ?? null,
      discount_percent: discountPercent,
    })
    await logPlatformAction(admin, gate.userId, 'set_override', companyId, {
      feature_key: key,
      included_in_base_override: body.included_in_base_override ?? null,
      price_cents_override: body.price_cents_override ?? null,
      discount_percent: discountPercent,
    })
    // Push the change to the tenant's live Stripe subscription now (best-effort; no-ops
    // when Stripe is dark or the tenant has no subscription).
    try {
      await reapplyCompanySubscriptionDiscounts(admin, companyId, getBillingMode())
    } catch (e) {
      console.error('[override] reapply discounts failed', (e as Error).message)
    }
    return NextResponse.json({ override })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

// DELETE — remove the override for a company (reverts to the catalog default).
// Body: { company_id }.
export async function DELETE(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const { key } = await params
  const body = (await request.json().catch(() => null)) as { company_id?: string } | null
  const companyId = typeof body?.company_id === 'string' ? body.company_id.trim() : ''
  if (!companyId) return NextResponse.json({ error: 'company_id is required.' }, { status: 400 })

  const admin = createAdminClient()
  try {
    await clearCompanyOverride(admin, key, companyId)
    await logPlatformAction(admin, gate.userId, 'clear_override', companyId, { feature_key: key })
    // Clearing removes any discount too — reflect that on the live subscription now.
    try {
      await reapplyCompanySubscriptionDiscounts(admin, companyId, getBillingMode())
    } catch (e) {
      console.error('[override] reapply discounts failed', (e as Error).message)
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
