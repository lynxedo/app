import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePlatformAdmin } from '@/lib/platform-auth'
import { listCatalog, updateCatalogFeature } from '@/lib/billing/catalog'

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
