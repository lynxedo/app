import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSms, twilioConfigured } from '@/lib/twilio'

// Called by VPS cron every minute:
//   curl -s -X POST https://staging.lynxedo.com/api/txt/broadcasts/process \
//     -H "x-cron-secret: $CRON_SECRET"
//
// Drains pending broadcast recipients. Respects the broadcast's own
// throttle_mps (default 8/sec — under the carrier A2P 10DLC cap of ~10
// for vetted standard sender). Runs for at most BATCH_MAX_MS so we
// never wedge the API process; remaining work is picked up next minute.
//
// For each queued recipient: find or create the per-contact direct
// conversation, insert an outbound message, call Twilio, update the
// message + recipient + broadcast counters atomically-ish.

const BATCH_MAX_MS = 50_000 // leave ~10s headroom inside the typical 60s cron interval
const PROCESS_MAX_PER_TICK = 200 // safety ceiling regardless of throttle

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const startedAt = Date.now()

  // Move any 'queued' broadcasts to 'processing' (stamp started_at). The
  // single-process cron means we don't have to lock — only one runner.
  const { data: queuedBroadcasts } = await admin
    .from('txt_broadcasts')
    .select('id, body, apply_signature, created_by, company_id, throttle_mps, recipient_count, skipped_count')
    .in('status', ['queued', 'processing'])
    .order('created_at', { ascending: true })

  if (!queuedBroadcasts || queuedBroadcasts.length === 0) {
    return NextResponse.json({ processed: 0, message: 'no work' })
  }

  let totalProcessed = 0
  const perBroadcast: Record<string, { sent: number; failed: number }> = {}

  for (const bc of queuedBroadcasts) {
    if (Date.now() - startedAt > BATCH_MAX_MS) break
    if (totalProcessed >= PROCESS_MAX_PER_TICK) break

    // Promote to processing on first touch.
    await admin
      .from('txt_broadcasts')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', bc.id)
      .eq('status', 'queued')

    // Cached sender signature (only fetched if apply_signature is on).
    let signature = ''
    if (bc.apply_signature) {
      const { data: profile } = await admin
        .from('user_profiles')
        .select('txt_signature')
        .eq('id', bc.created_by)
        .maybeSingle()
      signature = (profile?.txt_signature || '').trim()
    }

    const finalBody = bc.apply_signature && signature ? `${bc.body}\n\n${signature}` : bc.body

    const interMessageDelayMs = Math.max(50, Math.floor(1000 / Math.max(1, bc.throttle_mps || 8)))

    while (Date.now() - startedAt <= BATCH_MAX_MS && totalProcessed < PROCESS_MAX_PER_TICK) {
      const { data: nextBatch } = await admin
        .from('txt_broadcast_recipients')
        .select('id, contact_id')
        .eq('broadcast_id', bc.id)
        .eq('status', 'queued')
        .limit(25)
      if (!nextBatch || nextBatch.length === 0) break

      for (const recipient of nextBatch) {
        if (Date.now() - startedAt > BATCH_MAX_MS) break
        if (totalProcessed >= PROCESS_MAX_PER_TICK) break
        const sendOutcome = await sendOneRecipient({
          admin,
          companyId: bc.company_id,
          broadcastId: bc.id,
          recipientId: recipient.id,
          contactId: recipient.contact_id,
          senderId: bc.created_by,
          body: finalBody,
        })
        perBroadcast[bc.id] = perBroadcast[bc.id] || { sent: 0, failed: 0 }
        if (sendOutcome === 'sent') perBroadcast[bc.id].sent++
        else if (sendOutcome === 'failed') perBroadcast[bc.id].failed++
        totalProcessed++

        await new Promise((resolve) => setTimeout(resolve, interMessageDelayMs))
      }
    }

    // Recount + maybe mark broadcast complete.
    const { count: remaining } = await admin
      .from('txt_broadcast_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('broadcast_id', bc.id)
      .eq('status', 'queued')

    const update: Record<string, unknown> = {}
    if (perBroadcast[bc.id]) {
      const { data: counts } = await admin
        .from('txt_broadcast_recipients')
        .select('status')
        .eq('broadcast_id', bc.id)
      const sentTotal = (counts ?? []).filter((r) => r.status === 'sent').length
      const failedTotal = (counts ?? []).filter((r) => r.status === 'failed').length
      const skippedTotal = (counts ?? []).filter((r) => r.status === 'skipped').length
      update.sent_count = sentTotal
      update.failed_count = failedTotal
      update.skipped_count = skippedTotal
    }
    if ((remaining || 0) === 0) {
      update.status = 'complete'
      update.completed_at = new Date().toISOString()
    }
    if (Object.keys(update).length > 0) {
      await admin.from('txt_broadcasts').update(update).eq('id', bc.id)
    }
  }

  return NextResponse.json({
    processed: totalProcessed,
    broadcasts: Object.keys(perBroadcast).length,
    elapsed_ms: Date.now() - startedAt,
  })
}

type SendOutcome = 'sent' | 'failed' | 'skipped'

async function sendOneRecipient(opts: {
  admin: ReturnType<typeof createAdminClient>
  companyId: string
  broadcastId: string
  recipientId: string
  contactId: string
  senderId: string
  body: string
}): Promise<SendOutcome> {
  const { admin, companyId, broadcastId, recipientId, contactId, senderId, body } = opts

  const { data: contact } = await admin
    .from('txt_contacts')
    .select('id, phone, do_not_text')
    .eq('id', contactId)
    .maybeSingle()
  if (!contact || !contact.phone) {
    await admin
      .from('txt_broadcast_recipients')
      .update({
        status: 'failed',
        error_message: 'Contact missing or no phone',
        processed_at: new Date().toISOString(),
      })
      .eq('id', recipientId)
    return 'failed'
  }
  if (contact.do_not_text) {
    await admin
      .from('txt_broadcast_recipients')
      .update({
        status: 'skipped',
        error_message: 'do_not_text',
        processed_at: new Date().toISOString(),
      })
      .eq('id', recipientId)
    return 'skipped'
  }

  // Find or create the direct conversation for this contact. Reuse it
  // if present (including archived — reopen so reply lands somewhere
  // useful).
  const { data: existingConv } = await admin
    .from('txt_conversations')
    .select('id, status')
    .eq('company_id', companyId)
    .eq('contact_id', contact.id)
    .eq('kind', 'direct')
    .maybeSingle()

  let conversationId: string
  if (existingConv) {
    conversationId = existingConv.id
    if (existingConv.status === 'archived') {
      await admin
        .from('txt_conversations')
        .update({ status: 'assigned', assigned_to: senderId, archived_by: null })
        .eq('id', conversationId)
    }
  } else {
    const { data: createdConv, error: convErr } = await admin
      .from('txt_conversations')
      .insert({
        company_id: companyId,
        contact_id: contact.id,
        assigned_to: senderId,
        status: 'assigned',
        kind: 'direct',
      })
      .select('id')
      .single()
    if (convErr || !createdConv) {
      await admin
        .from('txt_broadcast_recipients')
        .update({
          status: 'failed',
          error_message: convErr?.message || 'conversation insert failed',
          processed_at: new Date().toISOString(),
        })
        .eq('id', recipientId)
      return 'failed'
    }
    conversationId = createdConv.id
    await admin.from('txt_conversation_members').insert({
      conversation_id: conversationId,
      user_id: senderId,
      role: 'owner',
      added_by: senderId,
    })
  }

  const { data: insertedMsg, error: msgErr } = await admin
    .from('txt_messages')
    .insert({
      company_id: companyId,
      conversation_id: conversationId,
      contact_id: contact.id,
      direction: 'outbound',
      body,
      media_urls: [],
      sent_by: senderId,
      status: 'sending',
    })
    .select('id')
    .single()
  if (msgErr || !insertedMsg) {
    await admin
      .from('txt_broadcast_recipients')
      .update({
        status: 'failed',
        error_message: msgErr?.message || 'message insert failed',
        processed_at: new Date().toISOString(),
      })
      .eq('id', recipientId)
    return 'failed'
  }

  if (!twilioConfigured()) {
    await admin
      .from('txt_messages')
      .update({
        status: 'failed',
        error_message: 'Twilio not configured (staging dev mode)',
      })
      .eq('id', insertedMsg.id)
    await admin
      .from('txt_broadcast_recipients')
      .update({
        status: 'failed',
        error_message: 'twilio_not_configured',
        processed_at: new Date().toISOString(),
        conversation_id: conversationId,
        message_id: insertedMsg.id,
      })
      .eq('id', recipientId)
    return 'failed'
  }

  const statusCallback =
    (process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com') +
    '/api/txt/twilio/sms/status'

  const result = await sendSms({
    to: contact.phone,
    body,
    statusCallback,
  })

  if (!result.ok) {
    await admin
      .from('txt_messages')
      .update({ status: 'failed', error_message: result.error })
      .eq('id', insertedMsg.id)
    await admin
      .from('txt_broadcast_recipients')
      .update({
        status: 'failed',
        error_message: result.error,
        processed_at: new Date().toISOString(),
        conversation_id: conversationId,
        message_id: insertedMsg.id,
      })
      .eq('id', recipientId)
    return 'failed'
  }

  await admin
    .from('txt_messages')
    .update({ twilio_sid: result.sid, status: 'sent' })
    .eq('id', insertedMsg.id)
  await admin
    .from('txt_conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId)
  await admin
    .from('txt_broadcast_recipients')
    .update({
      status: 'sent',
      processed_at: new Date().toISOString(),
      conversation_id: conversationId,
      message_id: insertedMsg.id,
    })
    .eq('id', recipientId)
  return 'sent'
}
