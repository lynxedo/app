import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadServiceMappingData } from '@/lib/service-mapping-server'
import ServiceMappingPanel from './ServiceMappingPanel'

export const metadata = { title: 'Service Mapping' }
export const dynamic = 'force-dynamic'

export default async function ServiceMappingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_admin_products')
    .eq('id', user.id)
    .single()

  const isSuperAdmin = profile?.role === 'admin'
  if (!isSuperAdmin && !profile?.can_admin_products) redirect('/hub/home')
  if (!profile?.company_id) redirect('/hub/home')

  const admin = createAdminClient()
  const { serviceProducts, rounds, products, lineItemNames } = await loadServiceMappingData(admin, profile.company_id)

  return (
    <ServiceMappingPanel
      initialServiceProducts={serviceProducts}
      initialRounds={rounds}
      products={products}
      lineItemNames={lineItemNames}
    />
  )
}
