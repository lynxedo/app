import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePlatformAdmin } from '@/lib/platform-auth'
import { upsertCompanyOverride, clearCompanyOverride } from '@/lib/billing/catalog'
import { logPlatformAction } from '@/lib/billing/audit'

// Per-subscriber pricing overrides for one catalog feature (cross-company, platform
// super-admin only). Writes use the service-role admin client — company_billing_overrides
// is service-role only. The [key] path segment is the catalog feature_key.

// PUT — set/update an override. Body: { company_id, included_in_base_override, price_cents_override }.
// A null field means "inherit the catalog default" for that dimension.
export async function PUT(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const { key } = await params
  const body = (await request.json().catch(() => null)) as {
    company_id?: string
    included_in_base_override?: boolean | null
    price_cents_override?: number | null
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const companyId = typeof body.company_id === 'string' ? body.company_id.trim() : ''
  if (!companyId) return NextResponse.json({ error: 'company_id is required.' }, { status: 400 })

  const admin = createAdminClient()
  try {
    const override = await upsertCompanyOverride(admin, key, companyId, {
      included_in_base_override: body.included_in_base_override ?? null,
      price_cents_override: body.price_cents_override ?? null,
    })
    await logPlatformAction(admin, gate.userId, 'set_override', companyId, {
      feature_key: key,
      included_in_base_override: body.included_in_base_override ?? null,
      price_cents_override: body.price_cents_override ?? null,
    })
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
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
