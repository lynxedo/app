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

  const [settingsRes, usersRes, roomsRes, mappingsRes] = await Promise.all([
    admin
      .from('daily_log_settings')
      .select('completion_notify_user_ids, completion_notify_room_ids, on_my_way_template')
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
    admin
      .from('pesticide_line_item_mappings')
      .select('id, match_text, match_type, chemical_name, epa_registration_number, active_ingredients, target_pests, application_rate, notes, active')
      .eq('company_id', profile.company_id)
      .order('chemical_name'),
  ])

  const recipientUserIds: string[] = settingsRes.data?.completion_notify_user_ids ?? []
  const recipientRoomIds: string[] = settingsRes.data?.completion_notify_room_ids ?? []
  const onMyWayTemplate: string | null = settingsRes.data?.on_my_way_template ?? null
  const users = (usersRes.data ?? []).filter((u: { is_bot: boolean }) => !u.is_bot)
  const rooms = roomsRes.data ?? []
  const mappings = mappingsRes.data ?? []

  return (
    <DailyLogAdminPanel
      initialRecipientIds={recipientUserIds}
      initialRoomIds={recipientRoomIds}
      initialOnMyWayTemplate={onMyWayTemplate}
      users={users}
      rooms={rooms}
      initialMappings={mappings}
    />
  )
}
