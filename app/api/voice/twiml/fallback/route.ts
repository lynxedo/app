import { NextRequest, NextResponse } from 'next/server'
import {
  EMPTY_VOICE_TWIML,
  twimlRecordVoicemail,
  validateTwilioVoiceSignature,
  voiceConfigured,
} from '@/lib/twilio-voice'

// AI Voice Receptionist — ConversationRelay <Connect action=...> fallback.
//
// Twilio POSTs here when the <Connect><ConversationRelay> ends — including when
// the WS socket drops or the relay errors out. Rather than dead-air the caller,
// fall back to the standard voicemail flow (records + stores + queues + notifies
// via the existing /api/dialer/voice/voicemail/complete pipeline).

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

  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/voice/twiml/fallback`
  if (voiceConfigured()) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  // Twilio hits this <Connect action> URL whenever the ConversationRelay session
  // ends — INCLUDING a normal, completed call. When the assistant finished on its
  // own it already said goodbye and we sent `end` with reason 'assistant_complete',
  // so just hang up cleanly. Only genuine drops/errors (no or non-complete
  // handoff) should fall through to voicemail.
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(paramObj)) lower[k.toLowerCase()] = v
  let endReason = ''
  try {
    endReason = lower.handoffdata ? String(JSON.parse(lower.handoffdata).reason || '') : ''
  } catch {
    endReason = ''
  }
  if (endReason === 'assistant_complete') {
    return twimlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>')
  }

  return twimlResponse(
    twimlRecordVoicemail({
      action: `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/voicemail/complete`,
      spokenFallback:
        "Sorry, we had trouble connecting our assistant. Please leave a message after the beep and a team member will get back to you. Press pound when finished.",
    })
  )
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'voice.twiml.fallback',
  })
}
