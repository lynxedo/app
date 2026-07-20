import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePlatformAdmin } from '@/lib/platform-auth'
import { getBillingMode } from '@/lib/billing/catalog'
import { logPlatformAction } from '@/lib/billing/audit'
import type { SubscriptionStatus } from '@/lib/billing/types'

// Platform super-admin tenant inspector (cross-company). Returns one company's full
// billing picture for the current env's mode: its subscription, its module toggles, and
// any per-subscriber pricing overrides. Service-role admin client — this reads across a
// company RLS would otherwise scope out. The [id] path segment is the company_id.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const { id } = await params
  const admin = createAdminClient()
  const mode = getBillingMode()

  try {
    const { data: company, error: companyErr } = await admin
      .from('companies')
      .select('id, name, subdomain_slug, is_active')
      .eq('id', id)
      .maybeSingle()
    if (companyErr) throw new Error(companyErr.message)
    if (!company) return NextResponse.json({ error: 'Tenant not found.' }, { status: 404 })

    const { data: sub } = await admin
      .from('company_subscription')
      .select('status, trial_ends_at, current_period_end, cancel_at_period_end')
      .eq('company_id', id)
      .eq('mode', mode)
      .maybeSingle()

    const { data: moduleRows } = await admin
      .from('company_module_subscription')
      .select('feature_key, active')
      .eq('company_id', id)
      .eq('mode', mode)

    const { data: overrideRows } = await admin
      .from('company_billing_overrides')
      .select('feature_key, included_in_base_override, price_cents_override')
      .eq('company_id', id)

    // Best-effort audit of the inspection (never blocks the response).
    await logPlatformAction(admin, gate.userId, 'inspect_tenant', id)

    return NextResponse.json({
      company: {
        id: company.id as string,
        name: company.name as string,
        subdomain_slug: (company.subdomain_slug as string | null) ?? null,
        is_active: company.is_active as boolean,
      },
      subscription: sub
        ? {
            status: sub.status as SubscriptionStatus,
            trial_ends_at: (sub.trial_ends_at as string | null) ?? null,
            current_period_end: (sub.current_period_end as string | null) ?? null,
            cancel_at_period_end: sub.cancel_at_period_end as boolean,
          }
        : null,
      modules: ((moduleRows ?? []) as Array<{ feature_key: string; active: boolean }>).map((m) => ({
        feature_key: m.feature_key,
        active: m.active,
      })),
      overrides: (
        (overrideRows ?? []) as Array<{
          feature_key: string
          included_in_base_override: boolean | null
          price_cents_override: number | null
        }>
      ).map((o) => ({
        feature_key: o.feature_key,
        included_in_base_override: o.included_in_base_override,
        price_cents_override: o.price_cents_override,
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
