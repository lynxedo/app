// Audit trail for cross-company platform-admin actions (Track 6, M4).
//
// Every side-effectful platform-console action (suspend/activate a tenant, set/clear a
// pricing override, run the Stripe sync) and the read-only tenant inspection logs one
// row here. Writes use the service-role admin client — platform_admin_audit has RLS
// enabled with NO policies. Auditing is BEST-EFFORT: it must never throw, so a logging
// failure can never break (or roll back) the main action it is recording.
import type { SupabaseClient } from '@supabase/supabase-js'

type Admin = SupabaseClient<any, any, any>

export type PlatformAction =
  | 'suspend_company'
  | 'activate_company'
  | 'set_override'
  | 'clear_override'
  | 'sync_stripe'
  | 'inspect_tenant'
  | 'create_company'

// Insert one audit row. Best-effort: any failure (DB error or unexpected throw) is
// swallowed so the caller's primary action always proceeds. targetCompanyId is null for
// platform-wide actions (e.g. sync_stripe) that aren't scoped to a single tenant.
export async function logPlatformAction(
  admin: Admin,
  actorUserId: string,
  action: PlatformAction,
  targetCompanyId: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from('platform_admin_audit').insert({
      actor_user_id: actorUserId,
      action,
      target_company_id: targetCompanyId,
      detail: detail ?? {},
    })
  } catch {
    /* best-effort: auditing must never break the main action */
  }
}
