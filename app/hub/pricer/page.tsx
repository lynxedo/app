import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBusinessProfile } from '@/lib/business-profile'
import PricerView from './PricerView'

export const metadata = { title: 'Pricer' }
export const dynamic = 'force-dynamic'

// Staff quoting tool. Reads live published program price charts (fed by the
// Service Builder) — replaces the hardcoded arrays in Pricer/pricer.html.
// Section access: admin, or the can_access_pricer flag (Admin → People).
export default async function PricerPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_access_pricer, company_id')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'
  if (!isAdmin && !profile?.can_access_pricer) redirect('/hub')

  const { businessName } = await getBusinessProfile(createAdminClient(), profile?.company_id ?? null)

  return <PricerView businessName={businessName} />
}
