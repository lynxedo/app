import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ImportPage from './ImportPage'

export default async function HubTrackerImportRoute() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/hub/tracker')

  return <ImportPage />
}
