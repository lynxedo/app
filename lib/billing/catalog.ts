// Service-role (admin-client) helpers for the platform billing catalog + tenant
// console. billing_catalog and company_billing_overrides have RLS enabled with NO
// policies, so ALL access here goes through the service-role admin client — never a
// user-scoped client. Mirrors the read-helper style of lib/beta-flags.ts.
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BillingCatalogFeature,
  BillingMode,
  CompanyBillingOverride,
  TenantSummary,
  SubscriptionStatus,
} from './types'

type Admin = SupabaseClient<any, any, any>

// The billing mode is derived PER-ENV from STRIPE_MODE (staging = test, prod = live).
// Anything other than the literal 'live' falls back to test — test is the safe default.
export function getBillingMode(): BillingMode {
  return process.env.STRIPE_MODE === 'live' ? 'live' : 'test'
}

// The full pricing catalog, ordered for a stable admin table.
export async function listCatalog(admin: Admin): Promise<BillingCatalogFeature[]> {
  const { data, error } = await admin
    .from('billing_catalog')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as BillingCatalogFeature[]
}

// The ONLY columns a platform admin may edit here. feature_key (the PK), is_base, and
// every stripe_* id are intentionally excluded — those are managed by Stripe wiring, not
// this editor. Any other key in the patch is silently ignored.
const CATALOG_EDITABLE = new Set([
  'label',
  'description',
  'category',
  'included_in_base',
  'default_price_cents',
  'cost_basis_cents',
  'gate_flags',
  'sort_order',
  'active',
])

// Patch one catalog feature. Applies the EDITABLE allowlist, stamps updated_at, and
// returns the updated row. Throws if the patch has no editable keys or the DB rejects it.
export async function updateCatalogFeature(
  admin: Admin,
  featureKey: string,
  patch: Record<string, unknown>,
): Promise<BillingCatalogFeature> {
  const updates: Record<string, unknown> = {}
  for (const k of Object.keys(patch)) if (CATALOG_EDITABLE.has(k)) updates[k] = patch[k]
  if (Object.keys(updates).length === 0) throw new Error('No editable fields provided.')
  updates.updated_at = new Date().toISOString()

  const { data, error } = await admin
    .from('billing_catalog')
    .update(updates)
    .eq('feature_key', featureKey)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as BillingCatalogFeature
}

// Set (or update) a per-subscriber override for a catalog feature. Passing null for a
// field means "inherit the catalog default" for that dimension.
export async function upsertCompanyOverride(
  admin: Admin,
  featureKey: string,
  companyId: string,
  values: {
    included_in_base_override: boolean | null
    price_cents_override: number | null
  },
): Promise<CompanyBillingOverride> {
  const { data, error } = await admin
    .from('company_billing_overrides')
    .upsert(
      {
        company_id: companyId,
        feature_key: featureKey,
        included_in_base_override: values.included_in_base_override ?? null,
        price_cents_override: values.price_cents_override ?? null,
      },
      { onConflict: 'company_id,feature_key' },
    )
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as CompanyBillingOverride
}

// Remove a per-subscriber override (the company reverts to the catalog default).
export async function clearCompanyOverride(
  admin: Admin,
  featureKey: string,
  companyId: string,
): Promise<void> {
  const { error } = await admin
    .from('company_billing_overrides')
    .delete()
    .eq('company_id', companyId)
    .eq('feature_key', featureKey)
  if (error) throw new Error(error.message)
}

// Every tenant company + a compact billing snapshot for the given mode: its
// company_subscription row (if any) and the count of its active module subscriptions.
// Done as three reads joined in memory (the codebase's Map-join pattern) rather than a
// PostgREST embed, so it stays reliable without FK-based relationships.
export async function listTenants(admin: Admin, mode: BillingMode): Promise<TenantSummary[]> {
  const { data: companyRows, error } = await admin
    .from('companies')
    .select('id, name, subdomain_slug, is_active, created_at')
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  const companies = (companyRows ?? []) as Array<{
    id: string
    name: string
    subdomain_slug: string | null
    is_active: boolean
    created_at: string
  }>
  if (companies.length === 0) return []

  const ids = companies.map((c) => c.id)

  const { data: subRows } = await admin
    .from('company_subscription')
    .select('company_id, status, trial_ends_at, current_period_end')
    .eq('mode', mode)
    .in('company_id', ids)
  const subByCompany = new Map<
    string,
    { status: SubscriptionStatus; trial_ends_at: string | null; current_period_end: string | null }
  >()
  for (const s of (subRows ?? []) as Array<{
    company_id: string
    status: SubscriptionStatus
    trial_ends_at: string | null
    current_period_end: string | null
  }>) {
    subByCompany.set(s.company_id, {
      status: s.status,
      trial_ends_at: s.trial_ends_at,
      current_period_end: s.current_period_end,
    })
  }

  const { data: moduleRows } = await admin
    .from('company_module_subscription')
    .select('company_id')
    .eq('mode', mode)
    .eq('active', true)
    .in('company_id', ids)
  const moduleCount = new Map<string, number>()
  for (const m of (moduleRows ?? []) as Array<{ company_id: string }>) {
    moduleCount.set(m.company_id, (moduleCount.get(m.company_id) ?? 0) + 1)
  }

  return companies.map((c) => ({
    company_id: c.id,
    name: c.name,
    subdomain_slug: c.subdomain_slug,
    is_active: c.is_active,
    subscription: subByCompany.get(c.id) ?? null,
    active_module_count: moduleCount.get(c.id) ?? 0,
  }))
}
