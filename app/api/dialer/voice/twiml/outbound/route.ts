import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  EMPTY_VOICE_TWIML,
  toE164,
  twimlDialPstn,
  twimlSayAndHangup,
  validateTwilioVoiceSignature,
  voiceCallerId,
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

// Twilio webhook target — configured as the Voice Request URL on the Twilio
// TwiML App that the Voice JS SDK references via TWILIO_TWIML_APP_SID.
// When the SDK initiates an outbound call, Twilio POSTs here with form params
// including the caller's identity, the dialed number, and standard call SIDs.
//
// We respond with TwiML telling Twilio to dial the requested PSTN number,
// and insert a `calls` row so the call shows up in Recent.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  // Validate signature when configured. In dev/staging without creds, skip
  // validation rather than reject — the same pattern Session 46 uses.
  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/twiml/outbound`
  if (voiceConfigured() && signature) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  // The SDK's `device.connect({ params: { To: '+1...' } })` flows To: into
  // this webhook. Identity is the user's hub_users.id from the access token.
  const toRaw = params.get('To') || ''
  const identity = params.get('From') || params.get('Caller') || ''
  const callSid = params.get('CallSid') || ''

  const to = toE164(toRaw)
  if (!to) {
    return twimlResponse(twimlSayAndHangup('Invalid number. Goodbye.'), 200)
  }

  // Best-effort calls-row insert. Failures here do NOT block the call — we
  // still return the dial TwiML so Twilio places the call. The user just
  // won't see the row in Recent (rare).
  try {
    const admin = createAdminClient()
    await admin.from('calls').insert({
      company_id: HEROES_COMPANY_ID,
      twilio_call_sid: callSid || null,
      direction: 'outbound',
      from_number: voiceCallerId() || 'app',
      to_number: to,
      status: 'initiated',
      initiated_by: identity || null,
      handled_by: identity || null,
    })
  } catch {
    // swallow — call still proceeds
  }

  const statusCb = `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/status`
  const recordingCb = `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/recording`

  return twimlResponse(
    twimlDialPstn({
      to,
      callerId: voiceCallerId(),
      timeoutSeconds: 30,
      recordCalls: false, // off by default in v1 — opt-in per company in a later session
      recordingStatusCallback: recordingCb,
      statusCallback: statusCb,
    })
  )
}

// Allow Twilio's URL verification GET (Twilio sometimes pings for connectivity).
export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'dialer.voice.twiml.outbound',
  })
}
