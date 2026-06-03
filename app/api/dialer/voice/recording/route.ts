import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  EMPTY_VOICE_TWIML,
  downloadTwilioRecording,
  validateTwilioVoiceSignature,
  voiceConfigured,
} from '@/lib/twilio-voice'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

function twimlResponse(body: string = EMPTY_VOICE_TWIML, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

// Twilio recording status callback — fires when a call recording is ready
// (both the outbound <Dial record> path and the inbound REST-API recording use
// this URL). We store the Twilio recording_url + duration, download the audio
// into R2, and flag the call transcription_status='pending'. The Phase 3
// transcription pipeline (Deepgram + Twilio VI) picks up pending rows.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/recording`
  if (voiceConfigured() && signature) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  const callSid = params.get('CallSid') || params.get('ParentCallSid') || ''
  const recordingUrl = params.get('RecordingUrl') || ''
  const recordingSid = params.get('RecordingSid') || ''
  const recordingDuration = params.get('RecordingDuration')
  const recordingStatus = params.get('RecordingStatus') || ''

  if (!callSid || !recordingUrl) return twimlResponse()
  // Only act on the final completed recording. Twilio also fires interim
  // 'in-progress' callbacks for long calls — those would overwrite each other.
  if (recordingStatus && recordingStatus !== 'completed') return twimlResponse()

  const admin = createAdminClient()

  // Resolve the owning call row for company scoping + the R2 key.
  const { data: callRow } = await admin
    .from('calls')
    .select('id, company_id')
    .eq('twilio_call_sid', callSid)
    .maybeSingle()
  const companyId = callRow?.company_id || HEROES_COMPANY_ID

  const update: Record<string, unknown> = {
    recording_url: recordingUrl,
  }
  if (recordingDuration) {
    const seconds = parseInt(recordingDuration, 10)
    if (!isNaN(seconds)) update.recording_duration_seconds = seconds
  }

  // Best-effort: copy the recording from Twilio into R2 so we own the audio and
  // can avoid Twilio storage fees. On success, flag it pending for transcription.
  if (
    recordingSid &&
    process.env.CF_R2_ACCESS_KEY_ID &&
    process.env.CF_R2_BUCKET_NAME
  ) {
    const media = await downloadTwilioRecording(recordingUrl)
    if (media) {
      const storageKey = `dialer/${companyId}/recordings/${recordingSid}.mp3`
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
        update.recording_storage_path = storageKey
        update.transcription_status = 'pending'
      } catch (err) {
        console.warn('[dialer.recording] R2 PutObject failed', err)
      }
    }
  }

  await admin.from('calls').update(update).eq('twilio_call_sid', callSid)

  return twimlResponse()
}

export async function GET() {
  return NextResponse.json({ ok: true, route: 'dialer.voice.recording' })
}
