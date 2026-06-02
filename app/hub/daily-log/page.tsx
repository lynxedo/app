import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DailyLogView from '@/components/hub/DailyLogView'

export const metadata = { title: 'Daily Log' }

export default async function DailyLogPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileResult, hubUsersResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('role, can_admin_daily_log, company_id')
      .eq('id', user.id)
      .single(),
    supabase
      .from('hub_users')
      .select('id, display_name, avatar_url, is_bot')
      .order('display_name'),
  ])

  const isAdmin =
    profileResult.data?.role === 'admin' ||
    profileResult.data?.can_admin_daily_log === true
  const isTech = !isAdmin

  const hubUsers = (hubUsersResult.data ?? []) as {
    id: string
    display_name: string
    avatar_url: string | null
    is_bot?: boolean
  }[]

  return (
    <DailyLogView
      currentUserId={user.id}
      companyId={profileResult.data?.company_id ?? ''}
      isAdmin={isAdmin}
      isTech={isTech}
      hubUsers={hubUsers}
    />
  )
}
