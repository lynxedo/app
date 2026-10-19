import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Timesheet admin = company admin role or the can_admin_timesheet grant — the same
// rule every /api/timesheet/admin route already applies. Returns the caller's
// company so service-role queries can be scoped to it.
export async function requireTimesheetAdmin(): Promise<
  { ok: true; userId: string; companyId: string } | { ok: false; res: NextResponse }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_timesheet) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  if (!profile?.company_id) return { ok: false, res: NextResponse.json({ error: 'No company' }, { status: 403 }) }
  return { ok: true, userId: user.id, companyId: profile.company_id }
}
