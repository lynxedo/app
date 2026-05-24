import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import ZoneSizerPanel from './ZoneSizerPanel'

export const metadata = { title: 'Zone Sizer' }

export default async function HubZoneSizerPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_zone_sizer, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_zone_sizer || !profile.company_id) redirect('/hub')

  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('zone_sizer_settings')
    .select('turf_sqft_per_zone, bed_sqft_per_zone')
    .eq('company_id', profile.company_id)
    .maybeSingle()

  return (
    <ZoneSizerPanel
      turfSqftPerZone={settings?.turf_sqft_per_zone ?? 1000}
      bedSqftPerZone={settings?.bed_sqft_per_zone ?? 1000}
    />
  )
}
