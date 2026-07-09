import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BETA_FEATURE_SELECT, type BetaFeature } from '@/lib/beta-flags'
import BetaAdminPanel from './BetaAdminPanel'

export const metadata = { title: 'Beta Features Admin' }

// Managing the beta registry is a super-admin function (same bar as Scoreboards
// admin). The parent admin layout already gates the area; this re-checks for
// full admin specifically.
export default async function BetaAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' || !profile.company_id) redirect('/hub/home')

  const admin = createAdminClient()
  const { data } = await admin
    .from('beta_features')
    .select(BETA_FEATURE_SELECT)
    .or(`company_id.is.null,company_id.eq.${profile.company_id}`)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  return <BetaAdminPanel initialFeatures={(data ?? []) as BetaFeature[]} />
}
