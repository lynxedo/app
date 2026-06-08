import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import RecurringServicesPage from './RecurringServicesPage'

export default async function HubRecurringServicesRoute() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return <RecurringServicesPage />
}
