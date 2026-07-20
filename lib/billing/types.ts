// Shared types for the platform super-admin billing feature (Track 5).
// These mirror the DB tables one-to-one (see the multi-tenant billing migration):
//   billing_catalog · company_billing_overrides · company_subscription ·
//   company_module_subscription
// Column nullability matches the schema exactly so the frontend can build against it.

// Per-env Stripe mode. Staging runs 'test', prod runs 'live' (see getBillingMode).
export type BillingMode = 'test' | 'live'

// Lifecycle status of a tenant's subscription (matches the DB check constraint).
export type SubscriptionStatus =
  | 'none'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'

// One row of the master pricing catalog. Every billable feature/module lives here.
export type BillingCatalogFeature = {
  feature_key: string
  label: string
  description: string
  category: string
  is_base: boolean
  included_in_base: boolean
  default_price_cents: number
  cost_basis_cents: number | null
  usage_source: string | null
  usage_metric: string | null
  gate_flags: string[]
  stripe_product_id: string | null
  stripe_price_id_test: string | null
  stripe_price_id_live: string | null
  // Usage-based (metered) billing (M4.5). When `metered` is true the feature bills a
  // flat base price (default_price_cents, above) PLUS per-unit usage reported to a
  // Stripe Billing Meter. `unit_price_cents` is the per-unit rate; the meter + metered
  // price ids are wired by syncCatalogToStripe. stripe_meter_id is account-wide; the
  // metered price id is per-mode (test/live).
  metered: boolean
  meter_event_name: string | null
  usage_unit: string | null
  unit_price_cents: number | null
  stripe_meter_id: string | null
  stripe_metered_price_id_test: string | null
  stripe_metered_price_id_live: string | null
  sort_order: number
  active: boolean
  retired_at: string | null
  created_at: string
  updated_at: string
}

// Per-subscriber override of a catalog feature's pricing (null = inherit catalog default).
export type CompanyBillingOverride = {
  company_id: string
  feature_key: string
  included_in_base_override: boolean | null
  price_cents_override: number | null
}

// A tenant company's subscription, keyed per billing mode (test/live coexist).
export type CompanySubscription = {
  company_id: string
  mode: BillingMode
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  status: SubscriptionStatus
  trial_ends_at: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  base_price_cents: number | null
}

// A single à-la-carte module a tenant is subscribed to, keyed per billing mode.
export type CompanyModuleSubscription = {
  company_id: string
  feature_key: string
  mode: BillingMode
  active: boolean
  stripe_subscription_item_id: string | null
}

// A row in the platform tenant console: one company plus a compact billing snapshot.
export type TenantSummary = {
  company_id: string
  name: string
  subdomain_slug: string | null
  is_active: boolean
  subscription: {
    status: SubscriptionStatus
    trial_ends_at: string | null
    current_period_end: string | null
  } | null
  active_module_count: number
}
