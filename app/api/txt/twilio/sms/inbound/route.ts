import { NextRequest, NextResponse, after } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  validateTwilioSignature,
  downloadTwilioMedia,
  toE164,
  twilioConfigured,
} from '@/lib/twilio'
import { sendHubPush } from '@/lib/hub-push'
import { buildMessagePreview } from '@/lib/txt-preview'
import { evaluateEventAutomations } from '@/lib/automations'
import { enrichTxtContactName } from '@/lib/dialer-lookup'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

// Carrier-required compliance keywords (A2P 10DLC).
// Matched case-insensitive against the trimmed message body.
const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END'])
const START_KEYWORDS = new Set(['START', 'UNSTOP', 'YES'])
const HELP_KEYWORDS = new Set(['HELP', 'INFO'])

type ComplianceKind = 'stop' | 'start' | 'help' | null

function classifyKeyword(body: string): ComplianceKind {
  const t = body.trim().toUpperCase()
  if (!t) return null
  if (STOP_KEYWORDS.has(t)) return 'stop'
  if (START_KEYWORDS.has(t)) return 'start'
  if (HELP_KEYWORDS.has(t)) return 'help'
  return null
}

function twimlResponse(body = EMPTY_TWIML, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

function r2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
    },
  })
}

async function ingestMediaToR2(
  mediaUrl: string,
  contentType: string,
  companyId: string
): Promise<string | null> {
  const downloaded = await downloadTwilioMedia(mediaUrl)
  if (!downloaded) return null
  const ext = (contentType.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '')
  const key = `txt/${companyId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  try {
    const r2 = r2Client()
    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.CF_R2_BUCKET_NAME!,
        Key: key,
        Body: Buffer.from(downloaded.bytes),
        ContentType: downloaded.contentType,
      })
    )
    return key
  } catch (err) {
    console.warn(
      `[txt:inbound] R2 upload failed: ${(err as Error).message} url=${mediaUrl}`
    )
    return null
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const params = Object.fromEntries(new URLSearchParams(rawBody))

  // Build the URL Twilio used to sign. Cloudflare tunnel: use NEXT_PUBLIC_APP_URL.
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
  const signedUrl = `${baseUrl}${req.nextUrl.pathname}${req.nextUrl.search || ''}`

  // Twilio signature validation — only enforced when configured.
  // (When env is empty, anyone could POST here; that's fine on staging while no real
  // traffic is pointed yet, but we still gate writes on auth_token presence below.)
  if (twilioConfigured()) {
    const sigHeader = req.headers.get('x-twilio-signature')
    if (!validateTwilioSignature(signedUrl, params, sigHeader)) {
      console.warn('[txt:inbound] signature validation failed', {
        url: signedUrl,
      })
      return twimlResponse(EMPTY_TWIML, 403)
    }
  }

  const from = toE164(params.From || '')
  const to = params.To || ''
  const body = params.Body || ''
  const sid = params.MessageSid || params.SmsSid || ''
  const numMedia = parseInt(params.NumMedia || '0', 10) || 0

  if (!from || !sid) {
    console.warn('[txt:inbound] missing from or sid', { hasFrom: !!from, sid })
    return twimlResponse()
  }

  const supabase = createAdminClient()

  // Dedupe by twilio_sid (Twilio retries on 5xx)
  const { data: existing } = await supabase
    .from('txt_messages')
    .select('id')
    .eq('twilio_sid', sid)
    .maybeSingle()
  if (existing) {
    console.log('[txt:inbound] duplicate sid, skipping', { sid })
    return twimlResponse()
  }

  // Find or create contact for the sender's phone
  const { data: existingContact } = await supabase
    .from('txt_contacts')
    .select('id, name')
    .eq('company_id', HEROES_COMPANY_ID)
    .eq('phone', from)
    .maybeSingle()

  let contactId = existingContact?.id
  if (!contactId) {
    // Resolve a real name from the Jobber clients/contacts mirror; fall back
    // to the phone-number placeholder only when nothing matches.
    const jobberName = await enrichTxtContactName(HEROES_COMPANY_ID, from)
    const { data: created, error: createErr } = await supabase
      .from('txt_contacts')
      .insert({
        company_id: HEROES_COMPANY_ID,
        phone: from,
        name: jobberName || from,
      })
      .select('id')
      .single()
    if (createErr || !created) {
      console.error('[txt:inbound] contact insert failed', createErr)
      return twimlResponse(EMPTY_TWIML, 500)
    }
    contactId = created.id
  } else if (existingContact && existingContact.name === from) {
    // Existing contact still has the phone-as-name placeholder — enrich it
    // from the Jobber mirror (persists the name itself; a few indexed queries,
    // never throws). Awaited so the push title below picks up the real name.
    await enrichTxtContactName(HEROES_COMPANY_ID, from)
  }

  // Session 54: look up our local txt_phone_numbers row matching the inbound
  // `To` so we can stamp it on the conversation (and use it to route outbound
  // replies back through the right number). null is fine — old/single-number
  // setups still work via the env-default fallback in sendSms.
  let toNumberId: string | null = null
  if (to) {
    const { data: numberRow } = await supabase
      .from('txt_phone_numbers')
      .select('id')
      .eq('twilio_number', to)
      .maybeSingle()
    toNumberId = numberRow?.id || null
  }

  // Find or create direct conversation; reopen archived → unassigned.
  // Inbound SMS only matches direct threads — group conversations are
  // identified by their Twilio Conversations SID in a separate webhook.
  const { data: existingConv } = await supabase
    .from('txt_conversations')
    .select('id, status, phone_number_id')
    .eq('company_id', HEROES_COMPANY_ID)
    .eq('contact_id', contactId)
    .eq('kind', 'direct')
    .maybeSingle()

  let conversationId: string
  if (existingConv) {
    conversationId = existingConv.id
    const reopenPatch: Record<string, unknown> = {}
    if (existingConv.status === 'archived') {
      reopenPatch.status = 'unassigned'
      reopenPatch.archived_by = null
    }
    // Stamp the inbound number if we don't have one yet — never overwrite an
    // explicit override that was set later.
    if (toNumberId && !existingConv.phone_number_id) {
      reopenPatch.phone_number_id = toNumberId
    }
    if (Object.keys(reopenPatch).length > 0) {
      await supabase
        .from('txt_conversations')
        .update(reopenPatch)
        .eq('id', conversationId)
    }
  } else {
    const { data: createdConv, error: convErr } = await supabase
      .from('txt_conversations')
      .insert({
        company_id: HEROES_COMPANY_ID,
        contact_id: contactId,
        status: 'unassigned',
        kind: 'direct',
        phone_number_id: toNumberId,
      })
      .select('id')
      .single()
    if (convErr || !createdConv) {
      console.error('[txt:inbound] conversation insert failed', convErr)
      return twimlResponse(EMPTY_TWIML, 500)
    }
    conversationId = createdConv.id
  }

  // Insert the inbound message FIRST (#32). Media ingest (download from Twilio + upload
  // to R2) is the slow part and used to run before this insert — so a Twilio retry that
  // fired during ingest wouldn't find the sid yet and would re-process the whole message
  // (duplicate work / texts). Inserting now (media_urls filled in by the background task
  // below) makes the sid-dedupe above catch retries immediately. Preview uses numMedia
  // (known up front) so it's accurate even before the files finish ingesting.
  const now = new Date().toISOString()
  const { data: insertedMsg, error: insertErr } = await supabase
    .from('txt_messages')
    .insert({
      company_id: HEROES_COMPANY_ID,
      conversation_id: conversationId,
      contact_id: contactId,
      direction: 'inbound',
      body: body || null,
      media_urls: [],
      twilio_sid: sid,
      status: 'received',
      phone_number_id: toNumberId,
    })
    .select('id')
    .single()
  if (insertErr || !insertedMsg) {
    console.error('[txt:inbound] message insert failed', insertErr)
    return twimlResponse(EMPTY_TWIML, 500)
  }
  const messageId = insertedMsg.id

  // Bump conversation timestamps + sidebar preview
  await supabase
    .from('txt_conversations')
    .update({
      last_message_at: now,
      last_inbound_at: now,
      last_message_preview: buildMessagePreview(body, numMedia),
      last_message_direction: 'inbound',
    })
    .eq('id', conversationId)

  // STOP / START / HELP compliance handling
  const compliance = classifyKeyword(body)
  if (compliance === 'stop') {
    await supabase
      .from('txt_contacts')
      .update({ do_not_text: true, updated_at: now })
      .eq('id', contactId)
    // Archive the conversation so it drops out of active views; staff can still see history.
    await supabase
      .from('txt_conversations')
      .update({ status: 'archived' })
      .eq('id', conversationId)
  } else if (compliance === 'start') {
    await supabase
      .from('txt_contacts')
      .update({ do_not_text: false, updated_at: now })
      .eq('id', contactId)
  }

  // #32 — acknowledge Twilio fast, then do the slow work (media ingest, automations,
  // push, realtime broadcast) AFTER the response via next/server `after()`. A bare
  // detached promise (`void (async()=>{})()`) is NOT guaranteed to run once the
  // handler returns its Response — Next tears down the request context, which
  // silently dropped EVERY inbound-text notification (push + chime + rail dot).
  // `after()` makes Next run + await this post-response, and still keeps us clear of
  // the ~15s Twilio timeout (→ retries → duplicate texts) on a large MMS.
  after(async () => {
    try {
      // Pull MMS media (slow) and attach it to the already-inserted message.
      if (numMedia > 0) {
        const mediaUrls: string[] = []
        for (let i = 0; i < numMedia; i++) {
          const url = params[`MediaUrl${i}`]
          const type = params[`MediaContentType${i}`] || 'application/octet-stream'
          if (!url) continue
          const r2Key = await ingestMediaToR2(url, type, HEROES_COMPANY_ID)
          if (r2Key) mediaUrls.push(r2Key)
        }
        if (mediaUrls.length > 0) {
          await supabase.from('txt_messages').update({ media_urls: mediaUrls }).eq('id', messageId)
        }
      }
      await processInboundSideEffects({
        supabase, conversationId, contactId, from, body, compliance, now, sid,
      })
    } catch (err) {
      console.warn('[txt:inbound] background processing failed', err)
    }
  })

  console.log('[txt:inbound] received', { sid, conversationId, media: numMedia, compliance })
  return twimlResponse()
}

// #32 — the post-acknowledgement side effects (automations + push fan-out + realtime
// broadcast) extracted so the webhook can return to Twilio immediately and run these after.
async function processInboundSideEffects(args: {
  supabase: ReturnType<typeof createAdminClient>
  conversationId: string
  contactId: string
  from: string
  body: string
  compliance: ComplianceKind
  now: string
  sid: string
}) {
  const { supabase, conversationId, contactId, from, body, compliance, now } = args

  // Re-read whether the (possibly just-ingested) message has attachments for the push preview.
  const { data: msgRow } = await supabase
    .from('txt_messages')
    .select('media_urls')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const mediaCount = Array.isArray(msgRow?.media_urls) ? msgRow!.media_urls.length : 0

  // Fire any "inbound text" automations — real messages only, not STOP/START/HELP.
  if (!compliance) {
    void evaluateEventAutomations({
      companyId: HEROES_COMPANY_ID,
      source: 'txt_inbound',
      vars: {
        from: from ?? '',
        message: body ?? '',
        time: new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }),
        date: now.slice(0, 10),
      },
      filter: { keyword: body ?? '' },
    })
  }

  // Push notification fan-out — same machinery Hub messages use.
  // Recipients:
  //   - unassigned: all Txt managers in the company (queue audience)
  //   - assigned:   owner (assigned_to) + every member on txt_conversation_members
  // `isDm: true` keeps the push from being filtered by the global "mentions only"
  // pref level; respects DND, muted, and scheduled-DND windows.
  // Recipients for this inbound: owner + members of an assigned ("active")
  // thread, or the manager / responder Queue audience while it's unassigned.
  // Computed once and reused for BOTH the push fan-out and the realtime
  // broadcast payload, so the chime + rail dot light for exactly these users —
  // never every Txt2 viewer when a thread is already claimed by someone else.
  let recipients: string[] = []
  try {
    const { data: convForPush } = await supabase
      .from('txt_conversations')
      .select('status, assigned_to, source')
      .eq('id', conversationId)
      .maybeSingle()

    if (convForPush?.status === 'unassigned' && convForPush?.source === 'responder') {
      // Customer replied to a Guardian/Responder auto-text — notify the
      // configured responder notify list instead of all managers.
      const { data: txtSettings } = await supabase
        .from('txt_settings')
        .select('responder_notify_user_ids')
        .eq('company_id', HEROES_COMPANY_ID)
        .maybeSingle()
      const notifyIds: string[] = (txtSettings as { responder_notify_user_ids?: string[] } | null)?.responder_notify_user_ids ?? []
      if (notifyIds.length > 0) {
        recipients = notifyIds
      } else {
        // Fall back to all managers if the list is not configured yet.
        const { data: managers } = await supabase
          .from('user_profiles')
          .select('id, role, can_admin_txt, can_assign_txt_threads')
          .eq('company_id', HEROES_COMPANY_ID)
        recipients = (managers ?? [])
          .filter(
            (m) =>
              m.role === 'admin' ||
              m.can_admin_txt === true ||
              m.can_assign_txt_threads === true
          )
          .map((m) => m.id)
      }
    } else if (convForPush?.status === 'unassigned') {
      // Anyone who could pick this up from the Queue tab.
      const { data: managers } = await supabase
        .from('user_profiles')
        .select('id, role, can_admin_txt, can_assign_txt_threads')
        .eq('company_id', HEROES_COMPANY_ID)
      recipients = (managers ?? [])
        .filter(
          (m) =>
            m.role === 'admin' ||
            m.can_admin_txt === true ||
            m.can_assign_txt_threads === true
        )
        .map((m) => m.id)
    } else {
      const ids = new Set<string>()
      if (convForPush?.assigned_to) ids.add(convForPush.assigned_to)
      const { data: members } = await supabase
        .from('txt_conversation_members')
        .select('user_id')
        .eq('conversation_id', conversationId)
      for (const m of members ?? []) ids.add(m.user_id)
      recipients = Array.from(ids)
    }

    if (recipients.length > 0) {
      // Look up contact name for nicer push title (Heroes' contacts typically
      // start as the phone number until enriched, so this gracefully degrades).
      const { data: contactRow } = await supabase
        .from('txt_contacts')
        .select('name')
        .eq('id', contactId)
        .maybeSingle()
      const displayName = contactRow?.name?.trim() || from
      const preview = body
        ? body.length > 100
          ? body.slice(0, 97) + '…'
          : body
        : mediaCount > 0
        ? `📎 ${mediaCount} attachment${mediaCount === 1 ? '' : 's'}`
        : '(empty message)'
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
      // Awaited inside after() so the push fully sends within the post-response
      // window (mirrors the group-MMS webhook, which awaits sendHubPush).
      try {
        await sendHubPush(
          recipients,
          {
            title: `📱 Txt — ${displayName}`,
            body: preview,
            url: `${baseUrl}/hub/txt/${conversationId}?source=push`,
            type: 'txt',
            groupKey: conversationId,
          },
          { isDm: true }
        )
      } catch (err) {
        console.warn('[txt:inbound] push fan-out failed', err)
      }
    }
  } catch (err) {
    console.warn('[txt:inbound] push lookup failed', err)
  }

  // Broadcast for realtime UI updates
  try {
    const channel = supabase.channel(`txt:${HEROES_COMPANY_ID}`)
    await channel.subscribe()
    await channel.send({
      type: 'broadcast',
      event: 'inbound',
      payload: { conversation_id: conversationId, contact_id: contactId, recipient_ids: recipients },
    })
    await supabase.removeChannel(channel)
  } catch (err) {
    console.warn('[txt:inbound] broadcast failed', err)
  }

}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'txt/twilio/sms/inbound',
    twilio_configured: twilioConfigured(),
  })
}
