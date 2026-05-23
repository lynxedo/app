import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminTimesheetPage from './AdminTimesheetPage'

export const metadata = { title: 'Time Records' }

export default async function AdminTimesheetTab() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_timesheet) redirect('/admin')

  return <AdminTimesheetPage />
}
