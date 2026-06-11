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

// Twilio call status callback — fires on status changes during + after the
// call (initiated, ringing, in-progress, completed, busy, no-answer, failed,
// canceled). We map these to our `calls.status` and stamp duration + ended_at.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/status`
  if (voiceConfigured() && signature) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  const callSid = params.get('CallSid') || params.get('ParentCallSid') || ''
  const callStatus = params.get('CallStatus') || ''
  const callDuration = params.get('CallDuration')
  const dialCallStatus = params.get('DialCallStatus')

  if (!callSid) return twimlResponse()

  const update: Record<string, unknown> = {}
  // For outbound calls placed via the SDK, status updates come on the parent
  // call SID. For inbound bridged to <Dial><Client>, the DialCallStatus is
  // also sent in an "action" callback. Prefer the explicit Dial result when
  // present (no-answer / busy / completed) over the parent CallStatus.
  const effective = dialCallStatus || callStatus
  if (effective) update.status = effective

  if (callDuration) {
    const seconds = parseInt(callDuration, 10)
    if (!isNaN(seconds)) update.duration_seconds = seconds
  }

  if (effective === 'completed' || effective === 'no-answer' ||
      effective === 'busy' || effective === 'failed' ||
      effective === 'canceled') {
    update.ended_at = new Date().toISOString()
  } else if (effective === 'in-progress' || effective === 'answered') {
    update.answered_at = new Date().toISOString()
  }

  if (Object.keys(update).length > 0) {
    const admin = createAdminClient()
    let q = admin.from('calls').update(update).eq('twilio_call_sid', callSid)
    // Don't let 'completed' overwrite a 'no-answer' we already stamped in the
    // agent-status callback (happens when the caller hangs up after voicemail).
    if (effective === 'completed') {
      q = (q as typeof q).not('status', 'in', '("no-answer","busy","failed","canceled")')
    }
    await q
  }

  return twimlResponse()
}

export async function GET() {
  return NextResponse.json({ ok: true, route: 'dialer.voice.status' })
}
