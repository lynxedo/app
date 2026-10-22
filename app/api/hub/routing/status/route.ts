import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { isJobberConnectedForCompany } from '@/lib/jobber'

// What the Routing page works out on the server, for its Workspace Tab twin
// (components/hub/workspace/RoutingTab.tsx), which has no server page of its own.
// Same rules as app/hub/routing/page.tsx: Jobber is company-wide, and only
// admins / Integrations admins may (re)connect it.
export async function GET() {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const { data: profile } = await auth.supabase
    .from('user_profiles')
    .select('can_admin_integrations')
    .eq('id', auth.userId)
    .maybeSingle()
  return NextResponse.json({
    jobberConnected: await isJobberConnectedForCompany(auth.companyId),
    canConnectJobber: auth.role === 'admin' || profile?.can_admin_integrations === true,
  })
}
