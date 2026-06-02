import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderTemplate } from '@/lib/txt-templates'
import { getTxtConvPermissions } from '@/lib/txt-permissions'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// GET — list this conversation's pending scheduled messages (composer drawer).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data } = await supabase
    .from('txt_scheduled_messages')
    .select('id, body, media_urls, send_at, status, created_at, sender_id')
    .eq('conversation_id', id)
    .eq('status', 'scheduled')
    .is('sent_at', null)
    .order('send_at', { ascending: true })

  return NextResponse.json({ scheduled: data ?? [] })
}

// POST — schedule a message for later delivery on this conversation.
// Body: { body?, media_urls?: string[], template_id?, send_at: ISO }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: conversationId } = await params
  const body = await request.json().catch(() => ({}))
  let text: string = (body.body || '').trim()
  const mediaUrls: string[] = Array.isArray(body.media_urls) ? body.media_urls : []
  const templateId: string | null =
    typeof body.template_id === 'string' && body.template_id ? body.template_id : null

  if (!text && mediaUrls.length === 0) {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  }
  if (!body.send_at) {
    return NextResponse.json({ error: 'send_at required' }, { status: 400 })
  }
  const sendAt = new Date(body.send_at)
  if (isNaN(sendAt.getTime()) || sendAt <= new Date()) {
    return NextResponse.json({ error: 'send_at must be in the future' }, { status: 400 })
  }

  const { data: conv, error: convErr } = await supabase
    .from('txt_conversations')
    .select(
      `id, kind, contact:txt_contacts!txt_conversations_contact_id_fkey ( id, name, do_not_text )`
    )
    .eq('id', conversationId)
    .single()
  if (convErr || !conv) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }
  const isGroup = conv.kind === 'group'
  const contact = Array.isArray(conv.contact) ? conv.contact[0] : conv.contact
  if (!isGroup && contact?.do_not_text) {
    return NextResponse.json({ error: 'Contact is marked do-not-text' }, { status: 400 })
  }

  const perms = await getTxtConvPermissions(supabase, conversationId, user.id)
  if (!perms.canReply) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Render template now (at schedule time) so the stored body is final.
  if (templateId && text) {
    const [{ data: sender }, { data: company }] = await Promise.all([
      admin.from('hub_users').select('display_name').eq('id', user.id).maybeSingle(),
      admin.from('companies').select('name').eq('id', HEROES_COMPANY_ID).maybeSingle(),
    ])
    text = renderTemplate(text, {
      contactName: contact?.name || null,
      senderName: sender?.display_name || null,
      companyName: company?.name || null,
    })
  }

  const { data: inserted, error } = await admin
    .from('txt_scheduled_messages')
    .insert({
      company_id: HEROES_COMPANY_ID,
      conversation_id: conversationId,
      sender_id: user.id,
      body: text || null,
      media_urls: mediaUrls,
      send_at: sendAt.toISOString(),
    })
    .select('id, body, media_urls, send_at, status, created_at, sender_id')
    .single()

  if (error || !inserted) {
    return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 })
  }
  return NextResponse.json({ scheduled: inserted }, { status: 201 })
}

// DELETE ?scheduled_id=... — cancel a pending scheduled message.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: conversationId } = await params
  const url = new URL(request.url)
  const scheduledId = url.searchParams.get('scheduled_id')
  if (!scheduledId) {
    return NextResponse.json({ error: 'scheduled_id required' }, { status: 400 })
  }

  const perms = await getTxtConvPermissions(supabase, conversationId, user.id)
  if (!perms.canReply) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('txt_scheduled_messages')
    .update({ status: 'canceled' })
    .eq('id', scheduledId)
    .eq('conversation_id', conversationId)
    .is('sent_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
