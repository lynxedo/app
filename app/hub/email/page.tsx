import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import EmailOversightPanel from '@/components/hub/email/EmailOversightPanel'
import { LIGHT_SURFACE_STYLE } from '@/components/hub/email/emailFormat'

/**
 * Hub Inbox landing (server component). Full-access users (admins /
 * can_access_shared_inbox) see the manager oversight dashboard; anyone else with
 * a foothold (compose right, a personal mailbox, or a thread shared to them) gets
 * a simple "pick a conversation" empty state. The thread list itself lives in the
 * sidebar mounted by the Hub shell — it is NOT rendered here.
 */
export default async function HubEmailPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const admin = createAdminClient()

  const { data: prof } = await admin
    .from('user_profiles')
    .select('role, can_access_shared_inbox, can_compose_shared_email, company_id')
    .eq('id', user.id)
    .maybeSingle()

  const isFull = prof?.role === 'admin' || prof?.can_access_shared_inbox
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

  // The email MAIN pane is deliberately light-themed (real-email-client look)
  // regardless of the user's Hub theme — only the sidebar keeps the Hub theme.
  return (
    <div
      className="email-light-surface flex-1 flex flex-col items-center px-6 py-8 overflow-y-auto bg-gray-100 text-gray-900"
      style={LIGHT_SURFACE_STYLE}
    >
      {isFull ? (
        <EmailOversightPanel />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="text-5xl mb-3">📥</div>
          <h1 className="text-xl font-medium mb-2 text-gray-900">Inbox</h1>
          <p className="text-sm text-gray-500 max-w-md">
            Pick a conversation from the sidebar to read and reply.
          </p>
        </div>
      )}
    </div>
  )
}
