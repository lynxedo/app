// Beta feature flags — the resolver. Mirrors how the can_access_* permission
// gates work, but user-controlled and sticky (see BETA_FEATURE_FLAGS_PRD.md).
//
// Two-layer gate — a feature is ON for a user iff BOTH:
//   1. Availability (admin layer): beta_features.is_available = true (and not retired).
//   2. Opt-in (user layer): the user opted in, OR the flag has default_on = true
//      and the user hasn't explicitly opted out.
// Gated first by can_access_beta: a user without beta eligibility gets an empty
// map (every beta off) — the same idea as not having a can_access_* grant.
//
// All reads use the service-role admin client (the caller already has one); rows
// are filtered by the explicit userId/companyId, so there's no cross-user leak.
import type { SupabaseClient } from '@supabase/supabase-js'

type Admin = SupabaseClient<any, any, any>

// A single beta feature as shown in the Admin → Beta list and the user's
// Settings → Beta Features tab.
export type BetaFeature = {
  key: string
  label: string
  description: string
  screenshot_url: string | null
  is_available: boolean
  default_on: boolean
  company_id: string | null
  sort_order: number
  retired_at: string | null
}

// featureKey → is-it-on-for-this-user. Passed to the client like permissions.
export type BetaFlagMap = Record<string, boolean>

export const BETA_FEATURE_SELECT =
  'key, label, description, screenshot_url, is_available, default_on, company_id, sort_order, retired_at'

// Only the betas visible to a user: available, not retired, and either
// platform-wide (company_id null) or scoped to the user's company. Ordered for
// a stable list in the UI. Does NOT apply the opt-in layer — that's per-user.
export async function listAvailableBetaFeatures(
  admin: Admin,
  companyId: string | null,
): Promise<BetaFeature[]> {
  const { data } = await admin
    .from('beta_features')
    .select(BETA_FEATURE_SELECT)
    .eq('is_available', true)
    .is('retired_at', null)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })
  const rows = (data ?? []) as BetaFeature[]
  return rows.filter((r) => r.company_id === null || r.company_id === companyId)
}

// The resolved flag map for one user. Empty when the user isn't beta-eligible.
export async function getBetaFlags(
  admin: Admin,
  userId: string,
  opts: { canAccessBeta: boolean; companyId: string | null },
): Promise<BetaFlagMap> {
  if (!opts.canAccessBeta) return {}

  const features = await listAvailableBetaFeatures(admin, opts.companyId)
  if (features.length === 0) return {}

  const { data: optinRows } = await admin
    .from('user_beta_optins')
    .select('feature_key, enabled')
    .eq('user_id', userId)
  const optins = new Map<string, boolean>()
  for (const o of (optinRows ?? []) as Array<{ feature_key: string; enabled: boolean }>) {
    optins.set(o.feature_key, o.enabled)
  }

  const map: BetaFlagMap = {}
  for (const f of features) {
    const explicit = optins.get(f.key)
    // Explicit choice wins; otherwise fall back to the flag's default_on.
    map[f.key] = explicit !== undefined ? explicit : f.default_on
  }
  return map
}

// Is a single beta feature globally available (admin kill-switch on, not
// retired)? Company-agnostic — for background jobs (crons) that aren't tied to
// one user, e.g. the broadcast drainer respecting the Admin → Beta kill-switch.
export async function isBetaFeatureAvailable(admin: Admin, key: string): Promise<boolean> {
  const { data } = await admin
    .from('beta_features')
    .select('is_available, retired_at')
    .eq('key', key)
    .maybeSingle()
  return !!data && data.is_available === true && data.retired_at === null
}

// Convenience: is ONE beta feature on for this user (availability + opt-in)?
// Thin wrapper over getBetaFlags for server routes/pages gating a single beta.
export async function userHasBetaFeature(
  admin: Admin,
  userId: string,
  key: string,
  opts: { canAccessBeta: boolean; companyId: string | null },
): Promise<boolean> {
  const flags = await getBetaFlags(admin, userId, opts)
  return flags[key] === true
}
