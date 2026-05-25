import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  EMPTY_VOICE_TWIML,
  twimlRecordVoicemail,
  validateTwilioVoiceSignature,
  voiceConfigured,
} from '@/lib/twilio-voice'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

function twimlResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

// Hit by Twilio as the action target on <Dial> in /voice/twiml/inbound.
// Twilio populates DialCallStatus telling us what happened on the inner dial:
//   completed      — call was answered and finished normally → just hang up
//   answered       — same idea, Twilio uses both depending on flow
//   no-answer      — rang out → record voicemail
//   busy/failed/canceled — caller didn't reach an agent → record voicemail
//
// We still let /voice/status (the separate parent-call Status Callback) handle
// stamping the calls row's duration/ended_at — that webhook always fires.
// Here we just decide between "end cleanly" and "record voicemail".
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/twiml/voicemail`
  if (voiceConfigured() && signature) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  const dialStatus = (params.get('DialCallStatus') || '').toLowerCase()
  const dialed = dialStatus === 'completed' || dialStatus === 'answered'

  if (dialed) {
    // Call connected and ended normally — no voicemail needed.
    return twimlResponse(EMPTY_VOICE_TWIML)
  }

  // Falling through to voicemail. Fetch the company greeting URL.
  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('dialer_settings')
    .select('fallback_voicemail_url')
    .eq('company_id', HEROES_COMPANY_ID)
    .single()

  return twimlResponse(
    twimlRecordVoicemail({
      action: `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/voicemail/complete`,
      greetingUrl: settings?.fallback_voicemail_url || null,
      spokenFallback:
        "Thanks for calling. Please leave a message after the beep and we'll get back to you. Press pound when finished.",
    })
  )
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'dialer.voice.twiml.voicemail',
  })
}
