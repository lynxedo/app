import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import DialerAdminPanel from './DialerAdminPanel'
import type { IvrConfig } from './IvrEditor'

export const metadata = { title: 'Dialer Admin' }

const DEFAULTS = {
  inbound_route_user_id: null as string | null,
  ring_timeout_sec: 20,
  voicemail_recipient_user_ids: [] as string[],
  fallback_voicemail_url: null as string | null,
  ivr_enabled: false,
  ivr_config: { trees: {} } as IvrConfig,
}

export default async function AdminDialerPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_admin_dialer')
    .eq('id', user.id)
    .single()
  if ((profile?.role !== 'admin' && !profile?.can_admin_dialer) || !profile?.company_id) {
    redirect('/hub/home')
  }

  const admin = createAdminClient()
  const [{ data: row }, { data: hubUsersRaw }] = await Promise.all([
    admin
      .from('dialer_settings')
      .select('*')
      .eq('company_id', profile.company_id)
      .maybeSingle(),
    admin
      .from('hub_users')
      .select('id, display_name')
      .eq('company_id', profile.company_id)
      .eq('is_bot', false)
      .order('display_name'),
  ])

  const settings = {
    ...DEFAULTS,
    ...(row ?? {}),
    voicemail_recipient_user_ids: row?.voicemail_recipient_user_ids ?? [],
    ivr_enabled: row?.ivr_enabled ?? false,
    ivr_config: (row?.ivr_config ?? { trees: {} }) as IvrConfig,
  }

  return (
    <DialerAdminPanel
      initial={settings}
      hubUsers={hubUsersRaw ?? []}
    />
  )
}
