import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DialerPanel from './DialerPanel'

export default async function DialerIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ number?: string; conversation_id?: string; contact_id?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_access_dialer, can_admin_dialer, can_admin_hub')
    .eq('id', user.id)
    .single()

  if (!profile?.can_access_dialer) redirect('/hub')

  const isAdmin =
    profile.role === 'admin' ||
    !!profile.can_admin_dialer ||
    !!profile.can_admin_hub

  // Session 57 — click-to-call from Txt. The 📞 button in TxtConversationView
  // navigates here with ?number=&conversation_id=&contact_id=. DialerPanel
  // pre-fills the dialpad; user taps the green Call button to actually dial.
  // conversation_id + contact_id ride through to the TwiML outbound webhook
  // so the resulting calls row links back to the originating Txt thread.
  const sp = await searchParams
  const initialNumber = typeof sp.number === 'string' ? sp.number : null
  const txtConversationId = typeof sp.conversation_id === 'string' ? sp.conversation_id : null
  const txtContactId = typeof sp.contact_id === 'string' ? sp.contact_id : null

  return (
    <DialerPanel
      isAdmin={isAdmin}
      initialNumber={initialNumber}
      txtConversationId={txtConversationId}
      txtContactId={txtContactId}
    />
  )
}
