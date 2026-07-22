import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import EmailThreadView from '@/components/hub/email/EmailThreadView'
import { resolveEffectiveSignature } from '@/lib/inbox/signature'

/**
 * Hub Inbox thread page (server component). Same access guard as the inbox
 * landing — a logged-in user with any inbox foothold (full access, compose
 * right, a personal mailbox, or a thread shared to them). Per-thread access is
 * enforced by the API: EmailThreadView loads GET /threads/{id} client-side and
 * shows a friendly "not available" state on 403/404, so we just pass the ids.
 */
export default async function HubEmailThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>
}) {
  const { threadId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const admin = createAdminClient()

  const { data: prof } = await admin
    .from('user_profiles')
    .select('role, can_manage_shared_inbox, can_access_shared_inbox, can_compose_shared_email, email_signature, company_id')
    .eq('id', user.id)
    .maybeSingle()

  const isFull = prof?.role === 'admin' || prof?.can_manage_shared_inbox || prof?.can_access_shared_inbox
  let ok = isFull || prof?.can_compose_shared_email
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

  const emailSignature = prof?.company_id
    ? await resolveEffectiveSignature(admin, prof.company_id as string, user.id)
    : (prof?.email_signature as string | null) || ''

  return (
    <EmailThreadView
      threadId={threadId}
      currentUserId={user.id}
      companyId={prof?.company_id || ''}
      emailSignature={emailSignature}
    />
  )
}
