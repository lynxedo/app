import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DailyLogV2View from '@/components/hub/DailyLogV2View'

export const metadata = { title: 'Daily Log v2 (preview)' }

export default async function DailyLogV2Page() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_daily_log')
    .eq('id', user.id)
    .single()

  const isAdmin =
    profile?.role === 'admin' ||
    profile?.can_admin_daily_log === true

  return (
    <DailyLogV2View
      currentUserId={user.id}
      isAdmin={isAdmin}
    />
  )
}
