import { NextRequest, NextResponse } from 'next/server'
import { EMPTY_VOICE_TWIML, validateTwilioVoiceSignature, voiceConfigured } from '@/lib/twilio-voice'
import { redirectCall } from '@/lib/twilio-conference'

function xml(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/xml' } })
}

// Status callback for the AGENT participant Twilio dials into an inbound
// conference. When the agent doesn't pick up (no-answer / busy / failed /
// canceled), we redirect the still-waiting CALLER out of the conference into
// voicemail — reproducing the legacy <Dial action> no-answer → voicemail
// behavior in the conference model.
//
// caller_sid + owner ride in the query string (set when the agent participant
// is created). On a normal answer (in-progress → completed) we do nothing.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const reqUrl = new URL(request.url)
  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}${reqUrl.pathname}${reqUrl.search}`
  if (voiceConfigured() && signature) {
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
    const voicemailUrl = `${baseUrl}/api/dialer/voice/twiml/voicemail${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`
    // Best-effort — if the caller already hung up, the redirect just no-ops.
    await redirectCall({ callSid: callerSid, twimlUrl: voicemailUrl }).catch(() => {})
  }

  return xml(EMPTY_VOICE_TWIML)
}

export async function GET() {
  return NextResponse.json({ ok: true, route: 'dialer.voice.conference.agent-status' })
}
