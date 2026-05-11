import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminTimesheetPage from './AdminTimesheetPage'

export default async function TimesheetAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  return <AdminTimesheetPage />
}
