import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ChecksView from './ChecksView'

export const metadata = { title: 'Checks' }
export const dynamic = 'force-dynamic'

// Open to everyone in Hub (Ben, Oct 15 2026): a tech, Ben or Kathryn photographs
// a customer's check here and it posts to the "checks and cash" room for Zac to
// deposit. The list and the Deposited button are scoped by /api/hub/checks.
export default async function ChecksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) redirect('/hub')

  return <ChecksView />
}
