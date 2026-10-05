import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DailyLogV2View from '@/components/hub/DailyLogV2View'
import { workOrderAccess, workOrderViewPerms } from '@/lib/work-order-access'

export const metadata = { title: 'Work Orders' }

export default async function DailyLogV2Page() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_daily_log, can_access_daily_log_v2, can_access_irrigation, can_access_dialer, can_access_txt, can_access_quotes, can_admin_quotes')
    .eq('id', user.id)
    .single()

  // One rule for the page and every Work Orders API (lib/work-order-access.ts).
  const { canAccess } = workOrderAccess(profile)
  if (!canAccess) redirect('/hub')

  // The viewer's buttons — the SAME helper the workspace-tab twin uses.
  const perms = workOrderViewPerms(profile)

  return <DailyLogV2View currentUserId={user.id} {...perms} />
}
