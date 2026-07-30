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
  'unit_price_cents',
  'cost_basis_cents',
  'gate_flags',
  'sort_order',
  'active',
  // Usage-based dimensions (a platform admin can turn a module into a metered one and set
  // its meter/unit). The Stripe meter + metered price are then minted by syncCatalogToStripe.
  'metered',
  'meter_event_name',
  'usage_unit',
])

// Slugify a label into a machine key (feature_key). Lowercase, non-alphanumerics → '_',
// trimmed, capped. This becomes the PK + Stripe/gating join key, so it is derived ONCE at
// creation and never changes afterward.
function slugifyKey(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'item'
  )
}

// Create a new catalog item. Derives a unique feature_key from the label, forces is_base
// false (there is exactly one seeded base row), and normalizes the usage fields so a
// non-metered item never carries stray meter data. The row starts active with no Stripe
// ids — a "Sync to Stripe" run provisions the product/price(s).
export async function createCatalogFeature(
  admin: Admin,
  values: {
    label: string
    category?: string | null
    included_in_base?: boolean
    default_price_cents?: number
    cost_basis_cents?: number | null
    gate_flags?: string[]
    metered?: boolean
    meter_event_name?: string | null
    usage_unit?: string | null
    unit_price_cents?: number | null
  },
): Promise<BillingCatalogFeature> {
  const label = (values.label ?? '').trim()
  if (!label) throw new Error('A name is required.')

  // Unique feature_key from the label (append _2, _3… on collision; never '__base__').
  const { data: existingRows } = await admin.from('billing_catalog').select('feature_key')
  const taken = new Set(
    ((existingRows ?? []) as Array<{ feature_key: string }>).map((r) => r.feature_key),
  )
  taken.add('__base__')
  const stem = slugifyKey(label)
  let key = stem
  let n = 2
  while (taken.has(key)) key = `${stem}_${n++}`

  const metered = values.metered === true
  const row = {
    feature_key: key,
    label,
    description: '',
    category: (values.category ?? '').trim() || 'operations',
    is_base: false,
    included_in_base: values.included_in_base === true,
    default_price_cents: Math.max(0, Math.round(values.default_price_cents ?? 0)),
    cost_basis_cents: values.cost_basis_cents ?? null,
    gate_flags: Array.isArray(values.gate_flags) ? values.gate_flags : [],
    metered,
    // A metered item needs a meter_event_name to provision a Stripe meter; default one
    // off the key when none was supplied so it's never null.
    meter_event_name: metered ? (values.meter_event_name?.trim() || `${key}_units`) : null,
    usage_unit: metered ? (values.usage_unit?.trim() || 'unit') : null,
    unit_price_cents: metered ? (values.unit_price_cents ?? 0) : null,
    sort_order: 100,
    active: true,
  }

  const { data, error } = await admin.from('billing_catalog').insert(row).select('*').single()
  if (error) throw new Error(error.message)
  return data as BillingCatalogFeature
}

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
    discount_percent: number | null
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
        discount_percent: values.discount_percent ?? null,
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
