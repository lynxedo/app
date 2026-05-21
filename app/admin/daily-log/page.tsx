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
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' || !profile.company_id) redirect('/dashboard')

  const admin = createAdminClient()

  const [settingsRes, usersRes] = await Promise.all([
    admin
      .from('daily_log_settings')
      .select('completion_notify_user_ids')
      .eq('company_id', profile.company_id)
      .maybeSingle(),
    admin
      .from('hub_users')
      .select('id, display_name, is_bot')
      .eq('company_id', profile.company_id)
      .order('display_name'),
  ])

  const recipientIds: string[] = settingsRes.data?.completion_notify_user_ids ?? []
  const users = (usersRes.data ?? []).filter((u: { is_bot: boolean }) => !u.is_bot)

  return <DailyLogAdminPanel initialRecipientIds={recipientIds} users={users} />
}
