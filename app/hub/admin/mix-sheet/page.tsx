import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadMixSheet } from '@/lib/mix-sheet-server'
import { todayInTz } from '@/lib/service-mapping'
import MixSheetView from './MixSheetView'

export const metadata = { title: 'Technician Mix Sheet' }
export const dynamic = 'force-dynamic'

export default async function MixSheetPage() {
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
  const payload = await loadMixSheet(admin, profile.company_id, todayInTz())

  return <MixSheetView initial={payload} />
}
