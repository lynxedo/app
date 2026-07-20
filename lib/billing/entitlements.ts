// Company-level module entitlements (Track 5, M3).
//
// Billing gates at the COMPANY level, in FRONT of the per-user can_access_* checks:
// a module is usable only if the company's subscription includes it AND the user has
// the grant. This file answers "which modules is this company entitled to".
//
// CRITICAL — FAIL OPEN: a company with no gating-active subscription (every existing
// tenant, including Heroes) is treated as entitled to everything. Gating only bites for
// a company actually put on a subscription. This guarantees the layer can never lock an
// existing tenant out of a feature it uses today.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BillingMode } from './types'

type Client = SupabaseClient<any, any, any>

// A subscription in one of these states means gating is ACTIVE for the company.
// 'none'/'incomplete' (customer created but never really subscribed) fail open.
// 'canceled' gates too, but drops add-ons back to just the included/base set.
const GATING_STATUSES = new Set(['trialing', 'active', 'past_due', 'canceled'])

export type CompanyEntitlements = {
  gatingActive: boolean
  // null = fail open (entitled to everything). Otherwise the set of entitled feature_keys.
  entitled: Set<string> | null
}

// Full entitlement set for a company — used server-side (layout) with the admin client
// (billing_catalog is service-role only). Entitled = catalog included-in-base/base
// features, ± per-company overrides, ∪ active module subscriptions (dropped when canceled).
export async function getCompanyEntitlements(
  admin: Client,
  companyId: string,
  mode: BillingMode,
): Promise<CompanyEntitlements> {
  const { data: sub } = await admin
    .from('company_subscription')
    .select('status')
    .eq('company_id', companyId)
    .eq('mode', mode)
    .maybeSingle()

  if (!sub || !GATING_STATUSES.has(sub.status)) {
    return { gatingActive: false, entitled: null } // fail open
  }

  const entitled = new Set<string>()

  const { data: catalog } = await admin
    .from('billing_catalog')
    .select('feature_key, included_in_base, is_base')
  for (const f of (catalog ?? []) as Array<{ feature_key: string; included_in_base: boolean; is_base: boolean }>) {
    if (f.included_in_base || f.is_base) entitled.add(f.feature_key)
  }

  const { data: overrides } = await admin
    .from('company_billing_overrides')
    .select('feature_key, included_in_base_override')
    .eq('company_id', companyId)
  for (const o of (overrides ?? []) as Array<{ feature_key: string; included_in_base_override: boolean | null }>) {
    if (o.included_in_base_override === true) entitled.add(o.feature_key)
    else if (o.included_in_base_override === false) entitled.delete(o.feature_key)
  }

  if (sub.status !== 'canceled') {
    const { data: mods } = await admin
      .from('company_module_subscription')
      .select('feature_key')
      .eq('company_id', companyId)
      .eq('mode', mode)
      .eq('active', true)
    for (const m of (mods ?? []) as Array<{ feature_key: string }>) entitled.add(m.feature_key)
  }

  return { gatingActive: true, entitled }
}

// Single-module check for MIDDLEWARE — uses the caller's own session client (RLS
// own-company read on company_subscription / company_module_subscription /
// company_billing_overrides), so it needs NO service-role access and no billing_catalog
// read. Billable modules default to included_in_base=false, so a billable module is
// entitled only via an active sub or an explicit per-company override.
export async function isBillableModuleEntitled(
  client: Client,
  companyId: string,
  mode: BillingMode,
  featureKey: string,
): Promise<boolean> {
  const { data: sub } = await client
    .from('company_subscription')
    .select('status')
    .eq('company_id', companyId)
    .eq('mode', mode)
    .maybeSingle()

  if (!sub || !GATING_STATUSES.has(sub.status)) return true // fail open

  // A per-company "included in base" override always entitles (survives cancellation).
  const { data: ovr } = await client
    .from('company_billing_overrides')
    .select('included_in_base_override')
    .eq('company_id', companyId)
    .eq('feature_key', featureKey)
    .maybeSingle()
  if (ovr?.included_in_base_override === true) return true

  // Active add-on subscription entitles, unless the subscription is canceled.
  if (sub.status !== 'canceled') {
    const { data: mod } = await client
      .from('company_module_subscription')
      .select('active')
      .eq('company_id', companyId)
      .eq('feature_key', featureKey)
      .eq('mode', mode)
      .maybeSingle()
    if (mod?.active) return true
  }

  return false
}

// Billable /hub route prefix → catalog feature_key, for middleware enforcement.
// Order matters: more-specific prefixes first. Core/included routes (hub, tracker,
// forms, timesheet, files, contacts, billing, admin) are intentionally absent — never gated.
const ROUTE_MODULE: Array<[string, string]> = [
  ['/hub/marketing/email', 'email'],
  ['/hub/marketing/drip', 'drip'],
  ['/hub/marketing', 'social'],
  ['/hub/dialer', 'dialer'],
  ['/hub/call-log2', 'dialer'],
  ['/hub/call-log', 'dialer'],
  ['/hub/txt', 'txt'],
  ['/hub/fleet', 'fleet'],
  ['/hub/scoreboards', 'scoreboards'],
  ['/hub/daily-log-v2', 'daily_log'],
  ['/hub/pricer', 'pricer'],
  ['/hub/mix-sheet', 'pricer'],
  ['/hub/pesticide-records', 'pricer'],
  ['/hub/lawn', 'lawn_size'],
  ['/hub/zone-sizer', 'lawn_size'],
  ['/hub/books', 'books'],
  ['/hub/routing', 'routing'],
]

// The billable module a path belongs to, or null if the path isn't a gated module route.
export function moduleForPath(pathname: string): string | null {
  for (const [prefix, mod] of ROUTE_MODULE) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return mod
  }
  return null
}
