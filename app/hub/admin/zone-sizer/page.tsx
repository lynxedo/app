import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import ZoneSizerAdminPanel from './ZoneSizerAdminPanel'

export const metadata = { title: 'Zone Sizer Admin' }

const DEFAULTS = {
  turf_sqft_per_zone: 1000,
  bed_sqft_per_zone: 1000,
}

export default async function AdminZoneSizerPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_admin_zone_sizer')
    .eq('id', user.id)
    .single()
  if ((profile?.role !== 'admin' && !profile?.can_admin_zone_sizer) || !profile?.company_id) redirect('/dashboard')

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('zone_sizer_settings')
    .select('*')
    .eq('company_id', profile.company_id)
    .maybeSingle()

  const settings = {
    ...DEFAULTS,
    ...(row ?? {}),
  }

  return <ZoneSizerAdminPanel initial={settings} />
}
