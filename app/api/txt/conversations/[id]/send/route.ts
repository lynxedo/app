import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSms, twilioConfigured } from '@/lib/twilio'
import { renderTemplate } from '@/lib/txt-templates'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

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

  // Load conversation + contact for the To number AND the contact name (for template render).
  const { data: conv, error: convErr } = await supabase
    .from('txt_conversations')
    .select(
      'id, contact_id, status, contact:txt_contacts ( id, name, phone, do_not_text )'
    )
    .eq('id', conversationId)
    .single()
  if (convErr || !conv) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }
  const contact = Array.isArray(conv.contact) ? conv.contact[0] : conv.contact
  if (!contact?.phone) {
    return NextResponse.json({ error: 'Contact has no phone' }, { status: 400 })
  }
  if (contact.do_not_text) {
    return NextResponse.json(
      { error: 'Contact is marked do-not-text' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  // Template render: when the caller flagged this send as template-driven,
  // resolve {first_name}, {company}, etc. server-side. Runs BEFORE the
  // signature auto-append so signature logic still sees the rendered body.
  if (templateId && text) {
    const [{ data: sender }, { data: company }] = await Promise.all([
      admin.from('hub_users').select('display_name').eq('id', user.id).maybeSingle(),
      admin.from('companies').select('name').eq('id', HEROES_COMPANY_ID).maybeSingle(),
    ])
    text = renderTemplate(text, {
      contactName: contact.name,
      senderName: sender?.display_name || null,
      companyName: company?.name || null,
    })
  }

  // Signature auto-append: tack on the sender's txt_signature when (a) the
  // message has text, (b) the user has a signature set, and (c) this is the
  // first time anyone has texted from this conversation OR a different user
  // is jumping in after someone else. Keeps clients aware of handoffs.
  let finalText = text
  if (text) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('txt_signature')
      .eq('id', user.id)
      .maybeSingle()
    const signature = (profile?.txt_signature || '').trim()
    if (signature) {
      const { data: lastOut } = await admin
        .from('txt_messages')
        .select('sent_by')
        .eq('conversation_id', conversationId)
        .eq('direction', 'outbound')
        .neq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!lastOut || lastOut.sent_by !== user.id) {
        finalText = `${text}\n\n${signature}`
      }
    }
  }

  // Insert the outbound row first with status='sending', then call Twilio
  const { data: inserted, error: insertErr } = await admin
    .from('txt_messages')
    .insert({
      company_id: HEROES_COMPANY_ID,
      conversation_id: conversationId,
      contact_id: contact.id,
      direction: 'outbound',
      body: finalText || null,
      media_urls: mediaUrls,
      sent_by: user.id,
      status: 'sending',
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
  }

  // Auto-assign if currently unassigned (Slack-like: replying claims it)
  if (conv.status === 'unassigned') {
    await admin
      .from('txt_conversations')
      .update({ assigned_to: user.id, status: 'assigned' })
      .eq('id', conversationId)
  }

  await admin
    .from('txt_conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId)

  // Try Twilio
  if (!twilioConfigured()) {
    await admin
      .from('txt_messages')
      .update({
        status: 'failed',
        error_message: 'Twilio not configured (staging dev mode)',
      })
      .eq('id', inserted.id)
    return NextResponse.json({
      ok: false,
      message_id: inserted.id,
      error: 'twilio_not_configured',
      status: 'failed',
    })
  }

  const statusCallback =
    (process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com') +
    '/api/txt/twilio/sms/status'

  const result = await sendSms({
    to: contact.phone,
    body: finalText,
    mediaUrls: mediaUrls.length ? mediaUrls : undefined,
    statusCallback,
  })

  if (!result.ok) {
    await admin
      .from('txt_messages')
      .update({ status: 'failed', error_message: result.error })
      .eq('id', inserted.id)
    return NextResponse.json({
      ok: false,
      message_id: inserted.id,
      error: result.error,
      code: result.code,
    })
  }

  await admin
    .from('txt_messages')
    .update({ twilio_sid: result.sid, status: 'sent' })
    .eq('id', inserted.id)

  return NextResponse.json({
    ok: true,
    message_id: inserted.id,
    twilio_sid: result.sid,
    status: result.status,
  })
}
