import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isJobberConnected } from '@/lib/jobber'
import RoutingAdminPanel from './RoutingAdminPanel'
import type { DurationRulesConfig } from '@/app/api/settings/types'
import { DEFAULT_DURATION_RULES } from '@/app/api/settings/types'

export const metadata = { title: 'Routing Admin' }

const DEFAULTS = {
  display_name: null as string | null,
  depot_address: null as string | null,
  depot_lat: null as number | null,
  depot_lng: null as number | null,
  default_service_minutes: 30,
  default_drive_mph: 25,
  duration_method: 'default' as string,
  duration_rules: DEFAULT_DURATION_RULES as DurationRulesConfig,
}

export default async function AdminRoutingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const { data: settingsRow } = await supabase
    .from('company_routing_settings')
    .select('display_name, depot_address, depot_lat, depot_lng, default_service_minutes, default_drive_mph, duration_method, duration_rules')
    .eq('company_id', profile.company_id!)
    .maybeSingle()

  const settings = {
    ...DEFAULTS,
    ...(settingsRow ?? {}),
    duration_rules: { ...DEFAULT_DURATION_RULES, ...((settingsRow?.duration_rules as Partial<DurationRulesConfig>) ?? {}) },
  }

  const jobberConnected = await isJobberConnected(user.id)

  return <RoutingAdminPanel initial={settings} jobberConnected={jobberConnected} />
}
