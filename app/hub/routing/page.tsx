import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isJobberConnectedForCompany } from '@/lib/jobber'
import RoutingScreen from './RoutingScreen'

export const metadata = { title: 'Routing' }

interface Props {
  searchParams: Promise<{ jobber?: string; error?: string }>
}

export default async function HubRoutingPage({ searchParams }: Props) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Company-scoped, not per-user. This used to call getJobberToken(user.id),
  // which reads through RLS (auth.uid() = user_id) and so answered "did I
  // personally connect Jobber" — meaning everyone except the one person who did
  // was shown "not connected" while Jobber was working perfectly well for them.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_admin_integrations')
    .eq('id', user.id)
    .single()
  const jobberConnected = profile?.company_id
    ? await isJobberConnectedForCompany(profile.company_id)
    : false

  // Connecting replaces the company's single connection, so the route is
  // admin-gated. Hide the buttons from everyone else rather than showing a
  // control that redirects them away with an error.
  const canConnectJobber = profile?.role === 'admin' || profile?.can_admin_integrations === true
  const params = await searchParams

  return (
    <RoutingScreen
      jobberConnected={jobberConnected}
      canConnectJobber={canConnectJobber}
      justConnected={params.jobber === 'connected'}
      connectError={params.error}
    />
  )
}
