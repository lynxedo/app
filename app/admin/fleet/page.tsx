import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import FleetAdminPanel from './FleetAdminPanel'

export const metadata = { title: 'Fleet Admin' }

const DEFAULTS = {
  alert_speeding: true,
  alert_after_hours: true,
  alert_low_fuel: true,
  alert_offline: true,
  speed_threshold_mph: 75,
  fuel_threshold_pct: 20,
  offline_timeout_min: 30,
  work_hours_start: '06:00',
  work_hours_end: '19:00',
  work_tz: 'America/Chicago',
}

export default async function AdminFleetPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_admin_fleet')
    .eq('id', user.id)
    .single()
  if ((profile?.role !== 'admin' && !profile?.can_admin_fleet) || !profile?.company_id) redirect('/dashboard')

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('fleet_settings')
    .select('*')
    .eq('company_id', profile.company_id)
    .maybeSingle()

  const settings = {
    ...DEFAULTS,
    ...(row ?? {}),
    // Trim seconds off time fields so HTML <input type="time"> accepts them
    work_hours_start: (row?.work_hours_start ?? DEFAULTS.work_hours_start).slice(0, 5),
    work_hours_end: (row?.work_hours_end ?? DEFAULTS.work_hours_end).slice(0, 5),
  }

  return <FleetAdminPanel initial={settings} />
}
