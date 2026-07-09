import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateTwilioSignature, toE164, twilioConfigured } from '@/lib/twilio'
import { sendHubPush } from '@/lib/hub-push'
import { buildMessagePreview } from '@/lib/txt-preview'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END'])
const START_KEYWORDS = new Set(['START', 'UNSTOP', 'YES'])

// Twilio Conversations webhook (group SMS). Fires onMessageAdded for every
// message in a group Conversation — both participant replies (Source=SMS) AND
// our own outbound (Source=API/SDK). We only record participant replies here;
// our outbound was already written by the send route. Wired per-conversation
// in start-group so staging + prod (shared Twilio account) each get their own.
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const params = Object.fromEntries(new URLSearchParams(rawBody))

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
  const signedUrl = `${baseUrl}${req.nextUrl.pathname}${req.nextUrl.search || ''}`

  if (twilioConfigured()) {
    const sigHeader = req.headers.get('x-twilio-signature')
    if (!validateTwilioSignature(signedUrl, params, sigHeader)) {
      console.warn('[txt:conv] signature validation failed', { url: signedUrl })
      return NextResponse.json({ error: 'bad signature' }, { status: 403 })
    }
  }

  // Only handle new messages. Other event types (onConversationStateUpdated,
  // delivery receipts, etc.) are ignored.
  if ((params.EventType || '') !== 'onMessageAdded') {
    return NextResponse.json({ ok: true, ignored: params.EventType || 'unknown' })
  }

  // Source tells us who added the message: SMS = a participant texted in;
  // API/SDK = our own send. We already store our outbound, so skip non-SMS.
  if ((params.Source || '') !== 'SMS') {
    return NextResponse.json({ ok: true, ignored: 'non-sms source' })
  }

  const conversationSid = params.ConversationSid || ''
  const messageSid = params.MessageSid || ''
  const author = toE164(params.Author || '') // participant's phone for SMS
  const body = params.Body || ''
  if (!conversationSid || !messageSid) {
    return NextResponse.json({ ok: true, ignored: 'missing ids' })
  }

  const supabase = createAdminClient()

  // Dedup — Twilio retries on non-2xx.
  const { data: dupe } = await supabase
    .from('txt_messages')
    .select('id')
    .eq('twilio_sid', messageSid)
    .maybeSingle()
  if (dupe) return NextResponse.json({ ok: true, duplicate: true })

  // Match the group conversation by its Twilio Conversations SID.
  const { data: conv } = await supabase
    .from('txt_conversations')
    .select('id, assigned_to, status')
    .eq('company_id', HEROES_COMPANY_ID)
    .eq('twilio_conversation_sid', conversationSid)
    .eq('kind', 'group')
    .maybeSingle()
  if (!conv) {
    console.warn('[txt:conv] no group conversation for sid', conversationSid)
    return NextResponse.json({ ok: true, ignored: 'unknown conversation' })
  }
  const conversationId = conv.id

  // Resolve which contact replied (match by phone within the company directory).
  let contactId: string | null = null
  if (author) {
    const { data: contact } = await supabase
      .from('txt_contacts')
      .select('id')
      .eq('company_id', HEROES_COMPANY_ID)
      .eq('phone', author)
      .maybeSingle()
    contactId = contact?.id ?? null
  }

  const now = new Date().toISOString()
  const { data: inserted, error: insertErr } = await supabase
    .from('txt_messages')
    .insert({
      company_id: HEROES_COMPANY_ID,
      conversation_id: conversationId,
      contact_id: contactId,
      direction: 'inbound',
      body: body || null,
      media_urls: [],
      twilio_sid: messageSid,
      status: 'received',
    })
    .select('id')
    .single()
  if (insertErr || !inserted) {
    // Non-2xx so Twilio retries.
    console.error('[txt:conv] message insert failed', insertErr)
    return NextResponse.json({ error: 'insert failed' }, { status: 500 })
  }

  // A member reply to an ARCHIVED group pops it back — same as a customer
  // texting an archived 1:1. Keep the owner if the group still has one.
  const reopenPatch: Record<string, unknown> =
    conv.status === 'archived'
      ? { status: conv.assigned_to ? 'assigned' : 'unassigned', archived_by: null }
      : {}
  await supabase
    .from('txt_conversations')
    .update({
      last_message_at: now,
      last_inbound_at: now,
      last_message_preview: buildMessagePreview(body, 0),
      last_message_direction: 'inbound',
      ...reopenPatch,
    })
    .eq('id', conversationId)

  // STOP / START compliance for the specific participant who texted in.
  const kw = body.trim().toUpperCase()
  if (contactId && STOP_KEYWORDS.has(kw)) {
    await supabase
      .from('txt_contacts')
      .update({ do_not_text: true, updated_at: now })
      .eq('id', contactId)
  } else if (contactId && START_KEYWORDS.has(kw)) {
    await supabase
      .from('txt_contacts')
      .update({ do_not_text: false, updated_at: now })
      .eq('id', contactId)
  }

  // Notify staff: the group owner + every added member.
  try {
    const recipients = new Set<string>()
    if (conv.assigned_to) recipients.add(conv.assigned_to)
    const { data: members } = await supabase
      .from('txt_conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId)
    for (const m of members ?? []) recipients.add(m.user_id)
    const ids = Array.from(recipients)

    if (ids.length > 0) {
      let who = author
      if (contactId) {
        const { data: c } = await supabase
          .from('txt_contacts')
          .select('name')
          .eq('id', contactId)
          .maybeSingle()
        who = c?.name?.trim() || author
      }
      const preview = body
        ? body.length > 100
          ? body.slice(0, 97) + '…'
          : body
        : '(empty message)'
      await sendHubPush(
        ids,
        {
          title: `👥 Group — ${who}`,
          body: preview,
          url: `${baseUrl}/hub/txt/${conversationId}?source=push`,
          type: 'txt',
          groupKey: conversationId,
        },
        { isDm: true }
      ).catch((err) => console.warn('[txt:conv] push fan-out failed', err))
    }

    // Realtime: same channel + event the direct-inbound path uses, so the open
    // thread reloads and the sidebar/rail dot light for exactly these users.
    const channel = supabase.channel(`txt:${HEROES_COMPANY_ID}`)
    await channel.subscribe()
    await channel.send({
      type: 'broadcast',
      event: 'inbound',
      payload: { conversation_id: conversationId, contact_id: contactId, recipient_ids: ids },
    })
    await supabase.removeChannel(channel)
  } catch (err) {
    console.warn('[txt:conv] notify failed', err)
  }

  console.log('[txt:conv] group reply recorded', { conversationId, messageSid })
  return NextResponse.json({ ok: true })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'txt/twilio/conversations',
    twilio_configured: twilioConfigured(),
  })
}
