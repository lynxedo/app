import { NextRequest, NextResponse } from 'next/server'
import { EMPTY_VOICE_TWIML, validateTwilioVoiceSignature, voiceConfigured } from '@/lib/twilio-voice'
import { redirectCall } from '@/lib/twilio-conference'

function xml(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/xml' } })
}

// Status callback for the CUSTOMER leg of an INTERNAL extension-to-extension
// call (one Hub user dials another user's 3-digit extension from the dialpad).
// When the dialed user doesn't answer, redirect the CALLER's leg to that user's
// PERSONAL voicemail box — the dialed-extension case is the one place (besides a
// caller entering an extension at the IVR) where a personal greeting is used.
//
// Kept deliberately separate from /conference/agent-status: that route also
// stamps the call 'no-answer' and fires an inbound "missed call" push, which is
// wrong for an outbound internal call.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const reqUrl = new URL(request.url)
  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}${reqUrl.pathname}${reqUrl.search}`
  if (voiceConfigured()) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return xml(EMPTY_VOICE_TWIML, 403)
    }
  }

  const callStatus = (params.get('CallStatus') || '').toLowerCase()
  const callerSid = reqUrl.searchParams.get('caller_sid') || ''
  const owner = reqUrl.searchParams.get('owner') || ''
  const unanswered = ['no-answer', 'busy', 'failed', 'canceled'].includes(callStatus)

  if (unanswered && callerSid) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    // Redirect (not a Dial action) → the voicemail route records straight away,
    // using the dialed user's personal greeting.
    const voicemailUrl = `${baseUrl}/api/dialer/voice/twiml/voicemail${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`
    await redirectCall({ callSid: callerSid, twimlUrl: voicemailUrl }).catch(() => {})
  }

  return xml(EMPTY_VOICE_TWIML)
}

export async function GET() {
  return NextResponse.json({ ok: true, route: 'dialer.voice.conference.internal-status' })
}
