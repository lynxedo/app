import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ClientConversation from '@/components/hub/ClientConversation'

export default async function ClientConversationPage({
  params,
}: {
  params: Promise<{ contactId: string }>
}) {
  const { contactId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [contactResult, messagesResult] = await Promise.all([
    supabase
      .from('hub_contacts')
      .select('id, name, phone, email, do_not_text')
      .eq('id', contactId)
      .single(),
    supabase
      .from('hub_sms_messages')
      .select('id, direction, body, status, captivated_sent, created_at, sent_by, sender:hub_users!sent_by (id, display_name)')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(200),
  ])

  if (contactResult.error || !contactResult.data) {
    notFound()
  }

  return (
    <ClientConversation
      contact={contactResult.data}
      messages={(messagesResult.data ?? []) as never}
    />
  )
}
