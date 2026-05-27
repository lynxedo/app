import { createClient } from '@/lib/supabase/server'

export type AdminArea = 'people' | 'hub' | 'routing' | 'timesheet' | 'fleet' | 'daily_log' | 'zone_sizer' | 'dialer' | 'contacts' | 'guardian'

// Guardian shares the Hub grant for now (see GUARDIAN_UPGRADE_PLAN.md — dedicated grant deferred).
const AREA_TO_FLAG: Record<AdminArea, string> = {
  people: 'can_admin_people',
  hub: 'can_admin_hub',
  routing: 'can_admin_routing',
  timesheet: 'can_admin_timesheet',
  fleet: 'can_admin_fleet',
  daily_log: 'can_admin_daily_log',
  zone_sizer: 'can_admin_zone_sizer',
  dialer: 'can_admin_dialer',
  contacts: 'can_admin_contacts',
  guardian: 'can_admin_hub',
}

export type AdminCheckResult = {
  ok: boolean
  user: { id: string; email: string | undefined } | null
  company_id: string | null
  isSuperAdmin: boolean
}

/**
 * Returns ok=true if the caller is a super-admin (role=admin) OR has the matching
 * can_admin_<area> grant set to true. Used by every /api/admin/* route.
 */
export async function requireAdminArea(area: AdminArea): Promise<AdminCheckResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, user: null, company_id: null, isSuperAdmin: false }

  const flag = AREA_TO_FLAG[area]
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_admin_people, can_admin_hub, can_admin_routing, can_admin_timesheet, can_admin_fleet, can_admin_daily_log, can_admin_zone_sizer, can_admin_dialer, can_admin_contacts')
    .eq('id', user.id)
    .single()

  if (!profile) return { ok: false, user: { id: user.id, email: user.email }, company_id: null, isSuperAdmin: false }

  const isSuperAdmin = profile.role === 'admin'
  const hasGrant = (profile as unknown as Record<string, unknown>)[flag] === true
  return {
    ok: isSuperAdmin || hasGrant,
    user: { id: user.id, email: user.email },
    company_id: profile.company_id,
    isSuperAdmin,
  }
}
