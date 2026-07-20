// Access check for the platform super-admin (billing / tenant-console) routes.
//
// This is the CROSS-COMPANY platform capability — the "God-mode" that lets Ben
// manage the pricing catalog and every tenant's subscription across the whole
// SaaS. It is DISTINCT from the company-scoped `role === 'admin'` (which only
// gates a single tenant's own admin area). A platform admin is flagged by
// user_profiles.is_platform_admin; role is intentionally NOT consulted here.
//
// Mirrors the shape of requireBetaAdmin in lib/beta-auth.ts.
import { createClient } from '@/lib/supabase/server'

export type PlatformAdminAccess =
  | { ok: true; userId: string; companyId: string }
  | { ok: false; status: 401 | 403 }

export async function requirePlatformAdmin(): Promise<PlatformAdminAccess> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401 }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, is_platform_admin')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.is_platform_admin !== true) return { ok: false, status: 403 }
  return { ok: true, userId: user.id, companyId: profile.company_id }
}
