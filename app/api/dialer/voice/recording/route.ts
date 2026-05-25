import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  EMPTY_VOICE_TWIML,
  validateTwilioVoiceSignature,
  voiceConfigured,
} from '@/lib/twilio-voice'

function twimlResponse(body: string = EMPTY_VOICE_TWIML, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

// Twilio recording status callback — fires when a call recording is ready.
// v1: store the Twilio recording_url + duration on the calls row.
// Full R2 download + transcript + AI summary lands in the Call Logs session
// (Phase 4). Recording itself is OFF by default in v1; this route is here so
// it's ready when an admin flips it on.
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
  const recordingDuration = params.get('RecordingDuration')
  const recordingStatus = params.get('RecordingStatus') || ''

  if (!callSid || !recordingUrl) return twimlResponse()
  // Only act on the final completed recording. Twilio also fires interim
  // 'in-progress' callbacks for long calls — those would overwrite each other.
  if (recordingStatus && recordingStatus !== 'completed') return twimlResponse()

  const update: Record<string, unknown> = {
    recording_url: recordingUrl,
  }
  if (recordingDuration) {
    const seconds = parseInt(recordingDuration, 10)
    if (!isNaN(seconds)) update.recording_duration_seconds = seconds
  }

  const admin = createAdminClient()
  await admin.from('calls').update(update).eq('twilio_call_sid', callSid)

  return twimlResponse()
}

export async function GET() {
  return NextResponse.json({ ok: true, route: 'dialer.voice.recording' })
}
