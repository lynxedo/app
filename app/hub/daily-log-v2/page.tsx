import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DailyLogV2View from '@/components/hub/DailyLogV2View'
import { workOrderAccess } from '@/lib/work-order-access'

export const metadata = { title: 'Work Orders' }

export default async function DailyLogV2Page() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_daily_log, can_access_daily_log_v2, can_access_irrigation, can_access_dialer, can_access_txt')
    .eq('id', user.id)
    .single()

  // One rule for the page and every Work Orders API (lib/work-order-access.ts).
  const { canAccess, isAdmin } = workOrderAccess(profile)
  if (!canAccess) redirect('/hub')

  // Starting / continuing an irrigation inspection from a stop needs the same
  // grant the customer file's Irrigation card uses (can_access_irrigation, or
  // the admin role). A Daily Log admin (can_admin_daily_log) does NOT get it
  // for free — same rule as lib/irrigation-server.ts resolveIrrigationAccess.
  const canAccessIrrigation = profile?.role === 'admin' || profile?.can_access_irrigation === true

  // The stop's 📞 Call / 💬 Text buttons — same grants as the Lead Tracker's.
  const canCall = profile?.role === 'admin' || profile?.can_access_dialer === true
  const canText = profile?.role === 'admin' || profile?.can_access_txt === true

  return (
    <DailyLogV2View
      currentUserId={user.id}
      isAdmin={isAdmin}
      canAccessIrrigation={canAccessIrrigation}
      canCall={canCall}
      canText={canText}
    />
  )
}
