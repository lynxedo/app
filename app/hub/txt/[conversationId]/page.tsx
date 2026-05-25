import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TxtConversationView from '@/components/hub/txt/TxtConversationView'

export default async function TxtConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}) {
  const { conversationId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_hub, can_assign_txt_threads, company_id')
    .eq('id', user.id)
    .single()

  const canAssign =
    profile?.role === 'admin' ||
    profile?.can_admin_hub === true ||
    profile?.can_assign_txt_threads === true

  const [convResult, messagesResult, notesResult, usersResult, meResult, companyResult] = await Promise.all([
    supabase
      .from('txt_conversations')
      .select(
        `id, status, assigned_to, last_message_at, last_inbound_at, created_at,
         contact:txt_contacts!txt_conversations_contact_id_fkey ( id, name, phone, email, do_not_text, jobber_client_id, notes ),
         assignee:hub_users!assigned_to ( id, display_name )`
      )
      .eq('id', conversationId)
      .single(),
    supabase
      .from('txt_messages')
      .select('id, direction, body, media_urls, status, error_message, twilio_sid, created_at, sent_by, sender:hub_users!sent_by ( id, display_name )')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(500),
    supabase
      .from('txt_notes')
      .select('id, body, created_at, created_by, author:hub_users!created_by ( id, display_name )')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200),
    supabase
      .from('hub_users')
      .select('id, display_name, is_bot')
      .eq('company_id', profile?.company_id || '')
      .eq('is_bot', false)
      .order('display_name'),
    supabase.from('hub_users').select('display_name').eq('id', user.id).maybeSingle(),
    supabase
      .from('companies')
      .select('name')
      .eq('id', profile?.company_id || '')
      .maybeSingle(),
  ])

  if (convResult.error || !convResult.data) {
    notFound()
  }

  return (
    <TxtConversationView
      initialConversation={convResult.data as never}
      initialMessages={(messagesResult.data ?? []) as never}
      initialNotes={(notesResult.data ?? []) as never}
      hubUsers={(usersResult.data ?? []) as never}
      currentUserId={user.id}
      currentUserName={meResult.data?.display_name || null}
      companyName={companyResult.data?.name || null}
      canAssign={!!canAssign}
    />
  )
}
