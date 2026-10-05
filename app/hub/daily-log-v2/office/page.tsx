import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import WorkOrdersOffice from '@/components/hub/WorkOrdersOffice'
import { workOrderAccess } from '@/lib/work-order-access'

export const metadata = { title: 'Work Orders — Office' }

// Work Orders Phase 2 — the office's lists: stops whose Jobber side needs
// attention, line items techs changed, and visits ready to invoice.
export default async function WorkOrdersOfficePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_daily_log, can_access_daily_log_v2')
    .eq('id', user.id)
    .single()
  if (!workOrderAccess(profile).isAdmin) redirect('/hub/daily-log-v2')

  return <WorkOrdersOffice />
}
