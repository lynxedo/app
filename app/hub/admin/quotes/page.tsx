import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { quoteAccess } from '@/lib/quote-access'
import QuotesAdminPanel from './QuotesAdminPanel'

export const metadata = { title: 'Quotes — Admin' }

// Work Orders & Quotes PRD — Phase 4, session 2: where the office builds the
// quote templates and keeps the reviews list (Ben builds his own — Oct 5 2026).
export default async function QuotesAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_access_quotes, can_admin_quotes')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id || !quoteAccess(profile).canAdmin) redirect('/hub')
  return <QuotesAdminPanel />
}
