import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import EmailBoardView from '@/components/hub/email/EmailBoardView'

/**
 * Hub Inbox board (server component). Same access guard as the inbox landing
 * (app/hub/email/page.tsx) — a logged-in user with any inbox foothold (manager,
 * Standard-user access, compose right, a personal mailbox, or a thread shared to
 * them). The board itself is a client component that fetches the shared inbox.
 */
export default async function HubEmailBoardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const admin = createAdminClient()

  const { data: prof } = await admin
    .from('user_profiles')
    .select('role, can_manage_shared_inbox, can_access_shared_inbox, can_compose_shared_email, company_id')
    .eq('id', user.id)
    .maybeSingle()

  const isManager = prof?.role === 'admin' || !!prof?.can_manage_shared_inbox
  let ok = isManager || prof?.can_access_shared_inbox || prof?.can_compose_shared_email
  if (!ok) {
    const { count: pa } = await admin
      .from('inbox_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('owner_user_id', user.id)
      .eq('active', true)
    const { count: tm } = await admin
      .from('inbox_thread_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', user.id)
    ok = !!((pa || 0) + (tm || 0))
  }
  if (!ok) redirect('/hub')

  return <EmailBoardView />
}
