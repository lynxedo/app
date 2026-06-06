import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CustomersReportView from './CustomersReportView'

export const metadata = { title: 'Customer Report' }
export const dynamic = 'force-dynamic'

export default async function CustomersReportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/hub')

  return <CustomersReportView />
}
