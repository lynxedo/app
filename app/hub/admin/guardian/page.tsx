import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKnowledgeDocs, getGuardianSettings } from '@/lib/guardian-knowledge'
import GuardianAdminPanel from './GuardianAdminPanel'

export const metadata = { title: 'Guardian Admin' }
export const dynamic = 'force-dynamic'

export default async function AdminGuardianPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_admin_hub')
    .eq('id', user.id)
    .single()

  const isSuperAdmin = profile?.role === 'admin'
  if ((!isSuperAdmin && !profile?.can_admin_hub) || !profile?.company_id) redirect('/hub/home')

  const admin = createAdminClient()
  const [docs, settings] = await Promise.all([
    getKnowledgeDocs(admin, profile.company_id),
    getGuardianSettings(admin, profile.company_id),
  ])

  return <GuardianAdminPanel initialDocs={docs} initialSettings={settings} />
}
