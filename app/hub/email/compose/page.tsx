import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import EmailComposeView from '@/components/hub/email/EmailComposeView'
import { resolveEffectiveSignature } from '@/lib/inbox/signature'

/**
 * Full-page "New email" composer (server component). Guard: anyone who can
 * actually send — full access / compose right on the shared box, or an active
 * personal mailbox. The composer itself loads the sendable accounts client-side
 * (same /api/hub/email/accounts source as the sidebar); we pass down the user's
 * signature so it's pre-loaded into the editor body.
 */
export default async function HubEmailComposePage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { draft: draftId } = await searchParams

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
    ok = !!(pa || 0)
  }
  if (!ok) redirect('/hub/email')

  const emailSignature = prof?.company_id
    ? await resolveEffectiveSignature(admin, prof.company_id as string, user.id)
    : (prof?.email_signature as string | null) || ''

  return (
    <EmailComposeView
      emailSignature={emailSignature}
      draftId={typeof draftId === 'string' ? draftId : undefined}
    />
  )
}
