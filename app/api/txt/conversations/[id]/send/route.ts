import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSms, twilioConfigured } from '@/lib/twilio'

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
  const text: string = (body.body || '').trim()
  const mediaUrls: string[] = Array.isArray(body.media_urls) ? body.media_urls : []

  if (!text && mediaUrls.length === 0) {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  }

  // Load conversation + contact for the To number
  const { data: conv, error: convErr } = await supabase
    .from('txt_conversations')
    .select('id, contact_id, status, contact:txt_contacts ( id, phone, do_not_text )')
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

  // Insert the outbound row first with status='sending', then call Twilio
  const { data: inserted, error: insertErr } = await admin
    .from('txt_messages')
    .insert({
      company_id: HEROES_COMPANY_ID,
      conversation_id: conversationId,
      contact_id: contact.id,
      direction: 'outbound',
      body: text || null,
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
    body: text,
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
