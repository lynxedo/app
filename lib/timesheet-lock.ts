// Approved pay weeks are locked. Every write path that changes a week's hours
// (punch add/edit/delete, day edit, Add time, edit-request approval, holiday
// overrides, PTO approval) calls weekLockError first and refuses with its message.
// Live clock in/out from the employee app is never blocked — someone working
// can't be stopped by a payroll screen.
//
// Lookup is by date range, not by a computed week start, so it holds whatever
// the company's pay-week start day is: an approval covers week_start … +6 days.

import type { SupabaseClient } from '@supabase/supabase-js'

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().split('T')[0]
}

function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** The live approval covering a Central calendar date, or null. */
export async function approvalCovering(
  admin: SupabaseClient,
  companyId: string,
  date: string,
): Promise<{ id: string; week_start: string; approved_at: string } | null> {
  const { data } = await admin
    .from('timesheet_week_approvals')
    .select('id, week_start, approved_at')
    .eq('company_id', companyId)
    .is('revoked_at', null)
    .gte('week_start', addDays(date, -6))
    .lte('week_start', date)
    .limit(1)
  return (data?.[0] as { id: string; week_start: string; approved_at: string } | undefined) ?? null
}

/** A refusal message if any of these dates sits in an approved week, else null. */
export async function weekLockError(
  admin: SupabaseClient,
  companyId: string,
  dates: string[],
  audience: 'admin' | 'employee' = 'admin',
): Promise<string | null> {
  for (const date of [...new Set(dates)]) {
    const a = await approvalCovering(admin, companyId, date)
    if (a && audience === 'employee') {
      return 'That pay week is already approved for payroll. Ask your manager to make the change.'
    }
    if (a) {
      return `Payroll for the week of ${shortDate(a.week_start)} – ${shortDate(addDays(a.week_start, 6))} is approved. Unapprove it in the Pay Period tab before changing that week.`
    }
  }
  return null
}

export { addDays as addDaysToDate }
