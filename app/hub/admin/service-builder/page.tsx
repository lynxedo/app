import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadServiceBuilderData } from '@/lib/service-builder-server'
import ServiceBuilderPanel from './ServiceBuilderPanel'

export const metadata = { title: 'Service Builder' }
export const dynamic = 'force-dynamic'

export default async function ServiceBuilderPage() {
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
  const { charts, products, rounds } = await loadServiceBuilderData(admin, profile.company_id)

  return (
    <ServiceBuilderPanel
      initialCharts={charts}
      products={products}
      seededRounds={rounds}
    />
  )
}
