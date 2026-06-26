import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TimesheetPage from './TimesheetPage'

export const metadata = { title: 'Timesheet' }

// Employee-facing timesheet view. Anyone with can_access_timesheet lands here
// (the Tools sidebar + Home time-clock card both link here); admins also get an
// "Admin view →" link to the admin panel at /hub/admin/timesheet. The middleware
// (proxy.ts) gates this path by can_access_timesheet.
export default async function HubTimesheet() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_access_timesheet, can_admin_timesheet')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin' || profile?.can_admin_timesheet === true

  if (!profile?.can_access_timesheet && !isAdmin) redirect('/hub')

  // Find the employee record linked to this user (may be null for an unlinked admin)
  const { data: employee } = await supabase
    .from('employees')
    .select('id, first_name, last_name, preferred_name, job_title, pay_type')
    .eq('user_id', user.id)
    .single()

  return (
    <TimesheetPage
      employee={employee ?? null}
      isAdmin={isAdmin}
      userEmail={user.email ?? ''}
    />
  )
}
