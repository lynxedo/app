import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireBetaAccess } from '@/lib/beta-auth'
import { listAvailableBetaFeatures } from '@/lib/beta-flags'

// User-facing beta endpoint for the Settings → Beta Features tab.
//   GET  — the betas this user can see, each with their current on/off state.
//   POST — set this user's opt-in for one feature ({ feature_key, enabled }).
// Both gated by requireBetaAccess (admin OR can_access_beta). All DB access goes
// through the (untyped) service-role admin client; the route scopes every row to
// the authed user, so there's no cross-user exposure.

export async function GET() {
  const gate = await requireBetaAccess()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const admin = createAdminClient()
  const features = await listAvailableBetaFeatures(admin, gate.companyId)
  const { data: optinRows } = await admin
    .from('user_beta_optins')
    .select('feature_key, enabled')
    .eq('user_id', gate.userId)
  const optins = new Map<string, boolean>()
  for (const o of (optinRows ?? []) as Array<{ feature_key: string; enabled: boolean }>)
    optins.set(o.feature_key, o.enabled)

  const out = features.map((f) => ({
    key: f.key,
    label: f.label,
    description: f.description,
    screenshot_url: f.screenshot_url,
    // Explicit opt-in wins; otherwise fall back to the flag's default_on.
    enabled: optins.has(f.key) ? optins.get(f.key)! : f.default_on,
  }))
  return NextResponse.json({ features: out })
}

export async function POST(request: Request) {
  const gate = await requireBetaAccess()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const raw = (await request.json().catch(() => null)) as {
    feature_key?: string
    enabled?: boolean
  } | null
  if (!raw?.feature_key || typeof raw.enabled !== 'boolean')
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const admin = createAdminClient()
  // Only allow opting into a feature actually available to this user (guards
  // against toggling a retired / force-off / other-company flag).
  const features = await listAvailableBetaFeatures(admin, gate.companyId)
  if (!features.some((f) => f.key === raw.feature_key))
    return NextResponse.json({ error: 'Unknown feature' }, { status: 404 })

  const { error } = await admin.from('user_beta_optins').upsert(
    {
      user_id: gate.userId,
      feature_key: raw.feature_key,
      enabled: raw.enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,feature_key' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
