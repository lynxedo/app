import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSms, twilioConfigured, twilioConvSendMessage } from '@/lib/twilio'
import { resolveFromNumber } from '@/lib/txt-numbers'

// Cron-driven delivery of due scheduled Txt messages. Wire on the VPS:
//   */1 * * * * curl -s -X POST https://lynxedo.com/api/txt/scheduled/process \
//     -H "x-cron-secret: $CRON_SECRET"
//
// Each due row is claimed (status scheduled -> sending) before sending so two
// overlapping cron runs can't double-send. Delivery reuses the same Twilio
// helpers as the live send route.
export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  const fail = async (id: string, message: string) => {
    await admin
      .from('txt_scheduled_messages')
      .update({ status: 'failed', error_message: message.slice(0, 300), sent_at: nowIso })
      .eq('id', id)
  }

  const { data: due, error } = await admin
    .from('txt_scheduled_messages')
    .select('id, company_id, conversation_id, sender_id, body, media_urls')
    .lte('send_at', nowIso)
    .is('sent_at', null)
    .eq('status', 'scheduled')
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) return NextResponse.json({ delivered: 0 })

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
  const statusCallback = baseUrl + '/api/txt/twilio/sms/status'
  let delivered = 0

  for (const sm of due) {
    // Claim the row — only one cron run wins the scheduled->sending transition.
    const { data: claimed } = await admin
      .from('txt_scheduled_messages')
      .update({ status: 'sending' })
      .eq('id', sm.id)
      .eq('status', 'scheduled')
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    try {
      const { data: conv } = await admin
        .from('txt_conversations')
        .select(
          `id, kind, twilio_conversation_sid, status,
           contact:txt_contacts!txt_conversations_contact_id_fkey ( id, phone, do_not_text )`
        )
        .eq('id', sm.conversation_id)
        .single()
      if (!conv) {
        await fail(sm.id, 'Conversation not found')
        continue
      }
      const isGroup = conv.kind === 'group'
      const contact = Array.isArray(conv.contact) ? conv.contact[0] : conv.contact

      if (!isGroup) {
        if (!contact?.phone) {
          await fail(sm.id, 'Contact has no phone')
          continue
        }
        if (contact.do_not_text) {
          await fail(sm.id, 'Contact opted out before send time')
          continue
        }
      }

      const { data: msg, error: insErr } = await admin
        .from('txt_messages')
        .insert({
          company_id: sm.company_id,
          conversation_id: sm.conversation_id,
          contact_id: isGroup ? null : contact?.id ?? null,
          direction: 'outbound',
          body: sm.body || null,
          media_urls: sm.media_urls || [],
          sent_by: sm.sender_id,
          status: 'sending',
        })
        .select('id')
        .single()
      if (insErr || !msg) {
        await fail(sm.id, 'Message insert failed')
        continue
      }

      // Auto-claim the conversation for the sender if it was unassigned.
      if (!isGroup && conv.status === 'unassigned') {
        await admin
          .from('txt_conversations')
          .update({ assigned_to: sm.sender_id, status: 'assigned' })
          .eq('id', conv.id)
        await admin
          .from('txt_conversation_members')
          .delete()
          .match({ conversation_id: conv.id, user_id: sm.sender_id })
        await admin.from('txt_conversation_members').insert({
          conversation_id: conv.id,
          user_id: sm.sender_id,
          role: 'owner',
          added_by: sm.sender_id,
        })
      }
      await admin
        .from('txt_conversations')
        .update({ last_message_at: nowIso })
        .eq('id', conv.id)

      if (!twilioConfigured()) {
        await admin
          .from('txt_messages')
          .update({ status: 'failed', error_message: 'Twilio not configured' })
          .eq('id', msg.id)
        await fail(sm.id, 'Twilio not configured')
        continue
      }

      const publicMediaUrls = (sm.media_urls || []).map((m: string) =>
        /^https?:\/\//i.test(m) ? m : `${baseUrl}/api/txt/media/${m}`
      )

      let result
      if (isGroup) {
        if (!conv.twilio_conversation_sid) {
          await admin
            .from('txt_messages')
            .update({ status: 'failed', error_message: 'Group not provisioned' })
            .eq('id', msg.id)
          await fail(sm.id, 'Group conversation not provisioned')
          continue
        }
        result = await twilioConvSendMessage({
          conversationSid: conv.twilio_conversation_sid,
          body: sm.body || '',
        })
      } else {
        const fromNumber = await resolveFromNumber(admin, {
          conversationId: conv.id,
          userId: sm.sender_id,
          companyId: sm.company_id,
        })
        result = await sendSms({
          to: contact!.phone,
          body: sm.body || '',
          mediaUrls: publicMediaUrls.length ? publicMediaUrls : undefined,
          statusCallback,
          fromNumber: fromNumber || undefined,
        })
      }

      if (!result.ok) {
        await admin
          .from('txt_messages')
          .update({ status: 'failed', error_message: result.error })
          .eq('id', msg.id)
        await fail(sm.id, result.error || 'Send failed')
        continue
      }

      await admin
        .from('txt_messages')
        .update({ twilio_sid: result.sid, status: 'sent' })
        .eq('id', msg.id)
      await admin
        .from('txt_scheduled_messages')
        .update({ status: 'sent', sent_at: nowIso })
        .eq('id', sm.id)
      delivered++
    } catch (e) {
      await fail(sm.id, e instanceof Error ? e.message : 'Delivery error')
    }
  }

  return NextResponse.json({ delivered })
}
