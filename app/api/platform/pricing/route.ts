import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePlatformAdmin } from '@/lib/platform-auth'
import { listCatalog, updateCatalogFeature, createCatalogFeature } from '@/lib/billing/catalog'
import { logPlatformAction } from '@/lib/billing/audit'

// Platform super-admin pricing catalog (cross-company). Reads/writes use the
// service-role admin client — billing_catalog has RLS enabled with no policies.

// GET — the full pricing catalog.
export async function GET() {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const admin = createAdminClient()
  try {
    const features = await listCatalog(admin)
    return NextResponse.json({ features })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

// PATCH — edit one catalog feature. Body: { feature_key, ...patch }. The catalog
// helper applies its own EDITABLE allowlist, so any non-editable key (incl.
// feature_key itself and the stripe_* ids) is ignored.
export async function PATCH(request: Request) {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const body = (await request.json().catch(() => null)) as
    | ({ feature_key?: string } & Record<string, unknown>)
    | null
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const featureKey = typeof body.feature_key === 'string' ? body.feature_key.trim() : ''
  if (!featureKey) return NextResponse.json({ error: 'feature_key is required.' }, { status: 400 })

  const admin = createAdminClient()
  try {
    const feature = await updateCatalogFeature(admin, featureKey, body)
    return NextResponse.json({ feature })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

// A finite non-negative integer cents value, or the fallback when blank/invalid.
function toCents(v: unknown, fallback: number | null): number | null {
  if (v == null || v === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.round(n)
}

// POST — create a new catalog item. Body: { label (required), category, included_in_base,
// default_price_cents, cost_basis_cents, metered, meter_event_name, usage_unit,
// unit_price_cents, gate_flags }. feature_key is derived from the label server-side.
export async function POST(request: Request) {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (!label) return NextResponse.json({ error: 'A name is required.' }, { status: 400 })

  const admin = createAdminClient()
  try {
    const feature = await createCatalogFeature(admin, {
      label,
      category: typeof body.category === 'string' ? body.category : null,
      included_in_base: body.included_in_base === true,
      default_price_cents: toCents(body.default_price_cents, 0) ?? 0,
      cost_basis_cents: toCents(body.cost_basis_cents, null),
      gate_flags: Array.isArray(body.gate_flags)
        ? (body.gate_flags.filter((g) => typeof g === 'string') as string[])
        : [],
      metered: body.metered === true,
      meter_event_name: typeof body.meter_event_name === 'string' ? body.meter_event_name : null,
      usage_unit: typeof body.usage_unit === 'string' ? body.usage_unit : null,
      unit_price_cents: toCents(body.unit_price_cents, 0),
    })
    await logPlatformAction(admin, gate.userId, 'create_catalog_feature', null, {
      feature_key: feature.feature_key,
      label: feature.label,
      category: feature.category,
      metered: feature.metered,
    })
    return NextResponse.json({ feature })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
