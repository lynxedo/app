import { NextRequest, NextResponse } from 'next/server'
import {
  EMPTY_VOICE_TWIML,
  validateTwilioVoiceSignature,
  voiceConfigured,
} from '@/lib/twilio-voice'
import { buildConversationRelayTwiml, buildWelcomeGreeting } from '@/lib/voice-receptionist'

// AI Voice Receptionist — standalone inbound voice webhook (Phase 1a).
//
// This is a DIRECT entry point: point a Twilio number's Voice webhook here to
// send every inbound call straight to the ConversationRelay AI receptionist,
// bypassing the dialer IVR entirely. Used for isolated testing (e.g. the 888
// backup number) before enabling the gated after-hours branch inside the main
// dialer inbound route.
//
// (The production trigger for Heroes' primary line lives in
// app/api/dialer/voice/twiml/inbound/route.ts, gated on AI_RECEPTIONIST_ENABLED
// + an after-hours/holiday IVR tree.)

export const runtime = 'nodejs'

function twimlResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  // Validate the Twilio signature exactly as the dialer inbound routes do.
  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/voice/twiml`
  if (voiceConfigured()) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin

  return twimlResponse(
    buildConversationRelayTwiml({
      baseUrl,
      wssUrl: process.env.VOICE_WSS_URL || '',
      wsKey: process.env.VOICE_WS_SECRET || '',
      voiceId: process.env.VOICE_ELEVENLABS_VOICE_ID || '',
      greeting: buildWelcomeGreeting(),
    })
  )
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'voice.twiml',
  })
}
