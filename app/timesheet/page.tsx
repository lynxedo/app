import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TimesheetPage from './TimesheetPage'

export default async function Timesheet() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_access_timesheet')
    .eq('id', user.id)
    .single()

  if (!profile?.can_access_timesheet && profile?.role !== 'admin') redirect('/dashboard')

  // Find the employee record linked to this user
  const { data: employee } = await supabase
    .from('employees')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return (
    <TimesheetPage
      employee={employee ?? null}
      isAdmin={profile?.role === 'admin'}
      userEmail={user.email ?? ''}
    />
  )
}
