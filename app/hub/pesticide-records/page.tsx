import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PesticideRecordsView from './PesticideRecordsView'

export const metadata = { title: 'Pesticide Records' }
export const dynamic = 'force-dynamic'

export default async function PesticideRecordsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_access_pesticide_records')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) redirect('/dashboard')
  const isAdmin = profile.role === 'admin'
  if (!isAdmin && !profile.can_access_pesticide_records) redirect('/hub')

  return <PesticideRecordsView />
}
