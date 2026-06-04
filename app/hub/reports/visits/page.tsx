import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import VisitsReportView from './VisitsReportView'

export const metadata = { title: 'Visit Report' }
export const dynamic = 'force-dynamic'

export default async function VisitsReportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/hub')

  return <VisitsReportView />
}
