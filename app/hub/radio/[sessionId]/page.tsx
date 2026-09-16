// The Radio channel screen. Deliberately its own route rather than an overlay inside
// the DM: a tapped push notification has somewhere to land, and Workspace Tabs keep a
// hidden page mounted — a live microphone inside a backgrounded overlay is a trap.
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import RadioScreen from '@/components/hub/radio/RadioScreen'
import { radioEffectiveStatus, radioExpiresAt, type RadioSessionRow } from '@/lib/radio/types'

export default async function RadioChannelPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/hub/radio/${sessionId}`)

  const admin = createAdminClient()
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_radio')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_radio) notFound()

  const { data } = await admin.from('radio_sessions').select('*').eq('id', sessionId).maybeSingle()
  const session = data as RadioSessionRow | null
  // A stranger shouldn't be able to confirm a session id exists — same 404 either way.
  if (!session || session.company_id !== profile.company_id) notFound()
  if (session.initiator_id !== user.id && session.recipient_id !== user.id) notFound()

  const otherId = session.initiator_id === user.id ? session.recipient_id : session.initiator_id
  const { data: names } = await admin.from('hub_users').select('id, display_name').in('id', [user.id, otherId])
  const nameOf = (id: string) =>
    ((names ?? []) as { id: string; display_name: string | null }[]).find(n => n.id === id)?.display_name || 'Teammate'

  const status = radioEffectiveStatus(session)

  return (
    <RadioScreen
      sessionId={session.id}
      initial={{
        session: { id: session.id, conversation_id: session.conversation_id, status },
        expiresAt: status === 'active' ? radioExpiresAt(session) : null,
        me: { id: user.id, name: nameOf(user.id), isInitiator: session.initiator_id === user.id },
        other: { id: otherId, name: nameOf(otherId) },
      }}
    />
  )
}
