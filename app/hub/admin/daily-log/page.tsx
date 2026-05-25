import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import DailyLogAdminPanel from './DailyLogAdminPanel'

export const metadata = { title: 'Daily Log Admin' }

export default async function AdminDailyLogPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_admin_daily_log')
    .eq('id', user.id)
    .single()
  if ((profile?.role !== 'admin' && !profile?.can_admin_daily_log) || !profile?.company_id) redirect('/dashboard')

  const admin = createAdminClient()

  const [settingsRes, usersRes, roomsRes] = await Promise.all([
    admin
      .from('daily_log_settings')
      .select('completion_notify_user_ids, completion_notify_room_ids')
      .eq('company_id', profile.company_id)
      .maybeSingle(),
    admin
      .from('hub_users')
      .select('id, display_name, is_bot')
      .eq('company_id', profile.company_id)
      .order('display_name'),
    admin
      .from('rooms')
      .select('id, name')
      .eq('company_id', profile.company_id)
      .is('archived_at', null)
      .order('name'),
  ])

  const recipientUserIds: string[] = settingsRes.data?.completion_notify_user_ids ?? []
  const recipientRoomIds: string[] = settingsRes.data?.completion_notify_room_ids ?? []
  const users = (usersRes.data ?? []).filter((u: { is_bot: boolean }) => !u.is_bot)
  const rooms = roomsRes.data ?? []

  return (
    <DailyLogAdminPanel
      initialRecipientIds={recipientUserIds}
      initialRoomIds={recipientRoomIds}
      users={users}
      rooms={rooms}
    />
  )
}
