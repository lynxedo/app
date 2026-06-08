import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import RouteCapacityPage from './RouteCapacityPage'

export default async function HubRouteCapacityRoute() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return <RouteCapacityPage />
}
