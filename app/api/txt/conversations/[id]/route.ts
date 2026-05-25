import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const [convResult, messagesResult, notesResult, membersResult, groupContactsResult] =
    await Promise.all([
      supabase
        .from('txt_conversations')
        .select(
          `id, kind, status, assigned_to, last_message_at, last_inbound_at, created_at,
           contact:txt_contacts!txt_conversations_contact_id_fkey ( id, name, phone, email, do_not_text, jobber_client_id, notes ),
           assignee:hub_users!assigned_to ( id, display_name )`
        )
        .eq('id', id)
        .single(),
      supabase
        .from('txt_messages')
        .select(
          'id, direction, body, media_urls, status, error_message, twilio_sid, created_at, sent_by, sender:hub_users!sent_by ( id, display_name )'
        )
        .eq('conversation_id', id)
        .order('created_at', { ascending: true })
        .limit(500),
      supabase
        .from('txt_notes')
        .select('id, body, created_at, created_by, author:hub_users!created_by ( id, display_name )')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true })
        .limit(200),
      supabase
        .from('txt_conversation_members')
        .select('user_id, role, added_at, user:hub_users!user_id ( id, display_name )')
        .eq('conversation_id', id),
      supabase
        .from('txt_conversation_contacts')
        .select('contact:txt_contacts!txt_conversation_contacts_contact_id_fkey ( id, name, phone, email, do_not_text )')
        .eq('conversation_id', id),
    ])

  if (convResult.error || !convResult.data) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  return NextResponse.json({
    conversation: convResult.data,
    messages: messagesResult.data ?? [],
    notes: notesResult.data ?? [],
    members: membersResult.data ?? [],
    group_contacts: groupContactsResult.data ?? [],
  })
}
