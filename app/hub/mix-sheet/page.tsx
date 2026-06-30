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

  // Any Hub user with a company may VIEW the sheet. Editing (notes, granular,
  // saved program selection) is gated to admins / the Products grant.
  if (!profile?.company_id) redirect('/hub/home')
  const canEdit = profile.role === 'admin' || !!profile.can_admin_products

  const admin = createAdminClient()
  const payload = await loadMixSheet(admin, profile.company_id, todayInTz())

  return <MixSheetView initial={payload} canEdit={canEdit} />
}
