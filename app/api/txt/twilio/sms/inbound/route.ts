import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  validateTwilioSignature,
  downloadTwilioMedia,
  toE164,
  twilioConfigured,
} from '@/lib/twilio'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

// Carrier-required compliance keywords (A2P 10DLC).
// Matched case-insensitive against the trimmed message body.
const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END'])
const START_KEYWORDS = new Set(['START', 'UNSTOP', 'YES'])
const HELP_KEYWORDS = new Set(['HELP', 'INFO'])

// TODO(session-50+): make these admin-editable per company.
const STOP_REPLY =
  'You have been unsubscribed and will no longer receive messages from Heroes Lawn Care. Reply START to resubscribe.'
const START_REPLY =
  "You're resubscribed to Heroes Lawn Care messages. Reply STOP to unsubscribe at any time."
const HELP_REPLY =
  'Reply STOP to unsubscribe. For help with Heroes Lawn Care, call (281) 698-7757 or visit heroeslawntx.com.'

type ComplianceKind = 'stop' | 'start' | 'help' | null

function classifyKeyword(body: string): ComplianceKind {
  const t = body.trim().toUpperCase()
  if (!t) return null
  if (STOP_KEYWORDS.has(t)) return 'stop'
  if (START_KEYWORDS.has(t)) return 'start'
  if (HELP_KEYWORDS.has(t)) return 'help'
  return null
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function twimlMessage(message: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(
    message
  )}</Message></Response>`
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
    console.warn('[txt:inbound] missing from or sid', { from, sid })
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
    const { data: created, error: createErr } = await supabase
      .from('txt_contacts')
      .insert({
        company_id: HEROES_COMPANY_ID,
        phone: from,
        name: from, // placeholder until enriched from Jobber
      })
      .select('id')
      .single()
    if (createErr || !created) {
      console.error('[txt:inbound] contact insert failed', createErr)
      return twimlResponse(EMPTY_TWIML, 500)
    }
    contactId = created.id
  }

  // Find or create direct conversation; reopen archived → unassigned.
  // Inbound SMS only matches direct threads — group conversations are
  // identified by their Twilio Conversations SID in a separate webhook.
  const { data: existingConv } = await supabase
    .from('txt_conversations')
    .select('id, status')
    .eq('company_id', HEROES_COMPANY_ID)
    .eq('contact_id', contactId)
    .eq('kind', 'direct')
    .maybeSingle()

  let conversationId: string
  if (existingConv) {
    conversationId = existingConv.id
    if (existingConv.status === 'archived') {
      await supabase
        .from('txt_conversations')
        .update({ status: 'unassigned', archived_by: null })
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
      })
      .select('id')
      .single()
    if (convErr || !createdConv) {
      console.error('[txt:inbound] conversation insert failed', convErr)
      return twimlResponse(EMPTY_TWIML, 500)
    }
    conversationId = createdConv.id
  }

  // Pull MMS media if present
  const mediaUrls: string[] = []
  for (let i = 0; i < numMedia; i++) {
    const url = params[`MediaUrl${i}`]
    const type = params[`MediaContentType${i}`] || 'application/octet-stream'
    if (!url) continue
    const r2Key = await ingestMediaToR2(url, type, HEROES_COMPANY_ID)
    if (r2Key) mediaUrls.push(r2Key)
  }

  // Insert the inbound message
  const now = new Date().toISOString()
  const { error: insertErr } = await supabase.from('txt_messages').insert({
    company_id: HEROES_COMPANY_ID,
    conversation_id: conversationId,
    contact_id: contactId,
    direction: 'inbound',
    body: body || null,
    media_urls: mediaUrls,
    twilio_sid: sid,
    status: 'received',
  })
  if (insertErr) {
    console.error('[txt:inbound] message insert failed', insertErr)
    return twimlResponse(EMPTY_TWIML, 500)
  }

  // Bump conversation timestamps
  await supabase
    .from('txt_conversations')
    .update({ last_message_at: now, last_inbound_at: now })
    .eq('id', conversationId)

  // STOP / START / HELP compliance handling
  const compliance = classifyKeyword(body)
  if (compliance === 'stop') {
    await supabase
      .from('txt_contacts')
      .update({ do_not_text: true })
      .eq('id', contactId)
    // Archive the conversation so it drops out of active views; staff can still see history.
    await supabase
      .from('txt_conversations')
      .update({ status: 'archived' })
      .eq('id', conversationId)
  } else if (compliance === 'start') {
    await supabase
      .from('txt_contacts')
      .update({ do_not_text: false })
      .eq('id', contactId)
  }

  // Broadcast for realtime UI updates
  try {
    const channel = supabase.channel(`txt:${HEROES_COMPANY_ID}`)
    await channel.subscribe()
    await channel.send({
      type: 'broadcast',
      event: 'inbound',
      payload: { conversation_id: conversationId, contact_id: contactId },
    })
    await supabase.removeChannel(channel)
  } catch (err) {
    console.warn('[txt:inbound] broadcast failed', err)
  }

  console.log('[txt:inbound] received', {
    from,
    to,
    sid,
    conversationId,
    media: mediaUrls.length,
    compliance,
  })

  if (compliance === 'stop') return twimlResponse(twimlMessage(STOP_REPLY))
  if (compliance === 'start') return twimlResponse(twimlMessage(START_REPLY))
  if (compliance === 'help') return twimlResponse(twimlMessage(HELP_REPLY))
  return twimlResponse()
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'txt/twilio/sms/inbound',
    twilio_configured: twilioConfigured(),
  })
}
