import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTxtConvPermissions } from '@/lib/txt-permissions'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const url = new URL(req.url)
  // Cursor for paginating older messages: ISO timestamp — return messages
  // created BEFORE this point (exclusive). Used by the "Load older" button.
  const before = url.searchParams.get('before')
  // Skip conversation/notes/members fetches when only paging backwards.
  const messagesOnly = url.searchParams.get('messages_only') === '1'

  // Permission gate: customer text threads are not viewable by every employee.
  // Allow Txt2 users (shared inbox) + the thread's own members/owner — the same
  // `canReply` gate the send/schedule/PATCH handlers use. Checked BEFORE any
  // data is fetched so a forbidden caller gets nothing.
  const perms = await getTxtConvPermissions(supabase, id, user.id)
  if (!perms.canReply) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Pagination: initial load fetches newest 500; load-older pages fetch 100 at a time.
  const msgLimit = before ? 100 : 500
  let msgQuery = supabase
    .from('txt_messages')
    .select(
      'id, direction, body, media_urls, status, error_message, twilio_sid, created_at, sent_by, sender:hub_users!sent_by ( id, display_name )'
    )
    .eq('conversation_id', id)
    .order('created_at', { ascending: false })
    .limit(msgLimit)
  if (before) {
    msgQuery = msgQuery.lt('created_at', before)
  }

  // Fast path: only messages needed (load-older pagination).
  if (messagesOnly) {
    const { data: msgs } = await msgQuery
    const reversed = (msgs ?? []).slice().reverse()
    return NextResponse.json({
      messages: reversed,
      has_more_older: reversed.length >= msgLimit,
    })
  }

  const [convResult, messagesResult, notesResult, membersResult, groupContactsResult] =
    await Promise.all([
      supabase
        .from('txt_conversations')
        .select(
          `id, kind, status, assigned_to, last_message_at, last_inbound_at, created_at, phone_number_id,
           contact:txt_contacts!txt_conversations_contact_id_fkey ( id, name, phone, email, do_not_text, jobber_client_id, notes ),
           assignee:hub_users!assigned_to ( id, display_name )`
        )
        .eq('id', id)
        .single(),
      msgQuery,
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

  const msgs = (messagesResult.data ?? []).slice().reverse()
  return NextResponse.json({
    conversation: convResult.data,
    // Reverse newest-N back to chronological order for the chat view (#33).
    messages: msgs,
    // True when there may be more messages before the earliest one loaded.
    has_more_older: msgs.length >= msgLimit,
    notes: notesResult.data ?? [],
    members: membersResult.data ?? [],
    group_contacts: groupContactsResult.data ?? [],
  })
}

// PATCH /api/txt/conversations/[id] — Session 54: set the per-conversation
// from-number override. Body: { phone_number_id: string | null }.
// Allowed for the conversation owner OR any Txt manager (canReply gates the
// equivalent "I have voice in this thread" notion).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const perms = await getTxtConvPermissions(supabase, id, user.id)
  if (!perms.canReply) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const patch: Record<string, unknown> = {}
  if ('phone_number_id' in body) {
    const v = body.phone_number_id
    if (v === null) {
      patch.phone_number_id = null
    } else if (typeof v === 'string' && v) {
      // Verify the number exists + is in same company (RLS-gated SELECT does
      // the company check for us).
      const { data: num } = await supabase
        .from('txt_phone_numbers')
        .select('id')
        .eq('id', v)
        .maybeSingle()
      if (!num) {
        return NextResponse.json({ error: 'Number not in your company' }, { status: 400 })
      }
      patch.phone_number_id = v
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('txt_conversations')
    .update(patch)
    .eq('id', id)
    .select('id, phone_number_id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ conversation: data })
}
