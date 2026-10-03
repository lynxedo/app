import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { LineItemStop } from '@/lib/work-order-line-items'

export type WorkOrderStop = LineItemStop & {
  entry_id: string
  completed_at: string | null
  jobber_complete_pending: boolean
  jobber_completed_at: string | null
  jobber_complete_error: string | null
  jobber_autopay: boolean | null
}

/**
 * Work Orders (Phase 2) access to one stop: a signed-in user in the stop's
 * company with the Work Orders grant (can_access_daily_log_v2) or Daily Log
 * admin rights (role admin / can_admin_daily_log) — the same gate as the page.
 * Returns the admin client for the writes; every write is scoped to this stop.
 */
export async function resolveWorkOrderStop(stopId: string): Promise<
  | { error: NextResponse }
  | { admin: ReturnType<typeof createAdminClient>; stop: WorkOrderStop; companyId: string; userId: string; isAdmin: boolean }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_admin_daily_log, can_access_daily_log_v2')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return { error: NextResponse.json({ error: 'No company' }, { status: 403 }) }
  const isAdmin = profile.role === 'admin' || profile.can_admin_daily_log === true
  if (!isAdmin && profile.can_access_daily_log_v2 !== true) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const admin = createAdminClient()
  const { data: stop } = await admin
    .from('daily_log_stops')
    .select('id, entry_id, status, completed_at, jobber_visit_id, jobber_job_id, line_items, jobber_complete_pending, jobber_completed_at, jobber_complete_error, jobber_autopay, daily_log_entries!inner(company_id)')
    .eq('id', stopId)
    .maybeSingle()
  const entry = stop ? (Array.isArray(stop.daily_log_entries) ? stop.daily_log_entries[0] : stop.daily_log_entries) : null
  if (!stop || !entry || (entry as { company_id: string }).company_id !== profile.company_id) {
    return { error: NextResponse.json({ error: 'Stop not found' }, { status: 404 }) }
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { daily_log_entries: _e, ...rest } = stop as typeof stop & { daily_log_entries: unknown }
  return { admin, stop: rest as unknown as WorkOrderStop, companyId: profile.company_id, userId: user.id, isAdmin }
}

/** Line items can change until the stop is complete or skipped (Reopen to change them after). */
export function lineItemsLocked(stop: Pick<WorkOrderStop, 'status'>): string | null {
  if (stop.status === 'complete') return 'This stop is complete — reopen it to change line items.'
  if (stop.status === 'skipped') return 'This stop was skipped.'
  return null
}
