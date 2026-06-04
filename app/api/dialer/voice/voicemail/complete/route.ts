import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendHubPush } from '@/lib/hub-push'
import {
  EMPTY_VOICE_TWIML,
  downloadTwilioRecording,
  validateTwilioVoiceSignature,
  voiceConfigured,
} from '@/lib/twilio-voice'
import { processVoicemail } from '@/lib/voicemail-transcribe'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

function twimlResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

// Twilio webhook: fires once after <Record> finalizes. Form params include
// RecordingUrl, RecordingSid, RecordingDuration, CallSid, From, etc.
// We download the audio to R2, insert a voicemails row, and fire push to the
// configured recipients. Response TwiML is empty — the call is already over.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const reqUrl = new URL(request.url)
  const ownerUserId = reqUrl.searchParams.get('owner') || null

  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}${reqUrl.pathname}${reqUrl.search}`
  if (voiceConfigured() && signature) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  const recordingUrl = params.get('RecordingUrl') || ''
  const recordingSid = params.get('RecordingSid') || ''
  const recordingDurationRaw = params.get('RecordingDuration')
  const callSid = params.get('CallSid') || ''
  const fromNumber = params.get('From') || ''

  if (!recordingUrl || !recordingSid) {
    // Caller likely hung up before recording started. Nothing to store.
    return twimlResponse(EMPTY_VOICE_TWIML)
  }

  const durationSec = recordingDurationRaw
    ? parseInt(recordingDurationRaw, 10) || null
    : null

  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    console.warn('[voicemail.complete] R2 not configured, skipping store')
    return twimlResponse(EMPTY_VOICE_TWIML)
  }

  const admin = createAdminClient()

  // Resolve the call row (best-effort) so we can FK link the voicemail back
  // to the matching calls entry from the Recent tab.
  let callId: string | null = null
  let contactId: string | null = null
  if (callSid) {
    const { data: callRow } = await admin
      .from('calls')
      .select('id, contact_id')
      .eq('twilio_call_sid', callSid)
      .maybeSingle()
    if (callRow) {
      callId = callRow.id
      contactId = callRow.contact_id
    }
  }
  if (!contactId && fromNumber) {
    const { data: contact } = await admin
      .from('txt_contacts')
      .select('id')
      .eq('company_id', HEROES_COMPANY_ID)
      .eq('phone', fromNumber)
      .maybeSingle()
    contactId = contact?.id ?? null
  }

  // Download the recording from Twilio and store in R2.
  const media = await downloadTwilioRecording(recordingUrl)
  if (!media) {
    console.warn('[voicemail.complete] Twilio recording download failed', { recordingUrl })
    return twimlResponse(EMPTY_VOICE_TWIML)
  }

  const storageKey = `dialer/${HEROES_COMPANY_ID}/voicemail/${recordingSid}.mp3`
  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
    },
  })
  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.CF_R2_BUCKET_NAME!,
        Key: storageKey,
        Body: Buffer.from(media.bytes),
        ContentType: media.contentType || 'audio/mpeg',
      })
    )
  } catch (err) {
    console.warn('[voicemail.complete] R2 PutObject failed', err)
    return twimlResponse(EMPTY_VOICE_TWIML)
  }

  const { data: voicemail, error: insertErr } = await admin
    .from('voicemails')
    .insert({
      company_id: HEROES_COMPANY_ID,
      call_id: callId,
      owner_user_id: ownerUserId,
      from_number: fromNumber || null,
      contact_id: contactId,
      twilio_recording_sid: recordingSid,
      recording_storage_path: storageKey,
      recording_duration_sec: durationSec,
    })
    .select('id')
    .single()

  if (insertErr || !voicemail) {
    console.warn('[voicemail.complete] insert failed', insertErr)
    return twimlResponse(EMPTY_VOICE_TWIML)
  }

  // Fire transcription async — runs Deepgram + Claude in the background so
  // the push notification fires immediately while transcription catches up.
  processVoicemail(voicemail.id).catch((err) => {
    console.warn('[voicemail.complete] transcription failed', voicemail.id, err)
  })

  // Mark the underlying call as missed-to-voicemail so the Recent tab can show
  // the link inline. Only stamp if the call row hasn't already been marked.
  if (callId) {
    await admin
      .from('calls')
      .update({ status: 'voicemail' })
      .eq('id', callId)
      .in('status', ['ringing', 'no-answer', 'busy', 'failed', 'canceled'])
  }

  // Push fan-out:
  //   - Per-user voicemail (owner set) → push to that owner only.
  //   - General voicemail (no owner)   → push to configured recipient list.
  let recipients: string[] = []
  if (ownerUserId) {
    recipients = [ownerUserId]
  } else {
    const { data: settings } = await admin
      .from('dialer_settings')
      .select('voicemail_recipient_user_ids')
      .eq('company_id', HEROES_COMPANY_ID)
      .single()
    recipients = settings?.voicemail_recipient_user_ids ?? []
  }
  if (recipients.length > 0) {
    let contactName: string | null = null
    if (contactId) {
      const { data: contact } = await admin
        .from('txt_contacts')
        .select('name')
        .eq('id', contactId)
        .maybeSingle()
      contactName = contact?.name ?? null
    }
    const caller = contactName || formatPhone(fromNumber) || 'Unknown caller'
    const duration = durationSec ? `${durationSec}s` : ''
    sendHubPush(recipients, {
      title: 'New voicemail',
      body: `${caller}${duration ? ` · ${duration}` : ''}`,
      url: `/hub/dialer?vm=${voicemail.id}`,
    }, { isDm: true }).catch((err) => {
      console.warn('[voicemail.complete] push fan-out failed', err)
    })
  }

  return twimlResponse(EMPTY_VOICE_TWIML)
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return raw
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'dialer.voice.voicemail.complete',
  })
}
