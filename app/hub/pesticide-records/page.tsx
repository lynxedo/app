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
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) redirect('/dashboard')

  return <PesticideRecordsView />
}
