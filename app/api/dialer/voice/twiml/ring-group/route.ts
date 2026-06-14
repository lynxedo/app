import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  EMPTY_VOICE_TWIML,
  validateTwilioVoiceSignature,
  voiceConfigured,
} from '@/lib/twilio-voice'
import { conferenceRoomName } from '@/lib/twilio-conference'
import { connectInboundToRingGroupViaConference } from '@/lib/dialer-conference-connect'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

function twimlResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

// Ring-group TwiML handler — every ring_group IVR action redirects here
// (?group=X&i=0), so this single route is the funnel for all group calls.
//
// Conference model (replaced the legacy sequential/simultaneous <Dial> chains
// so group-answered calls get in-call hold + transfer, same as the single-user
// route): the caller joins a per-call conference on hold music and members are
// REST-added as participants —
//   - sequential: one member at a time; each unanswered leg's agent-status
//     callback rings the next (advanceRingGroup in dialer-conference-connect);
//   - simultaneous: every available member at once; first to answer wins and
//     the sibling legs are canceled by the conference status callback.
// Group missing / empty / all-DND / exhausted → general voicemail, exactly
// like the legacy behavior. DND-now members are skipped at every step.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const url = new URL(request.url)
  const groupId = url.searchParams.get('group') || ''

  const signature = request.headers.get('x-twilio-signature')
  const validateUrl = `${process.env.NEXT_PUBLIC_APP_URL}${url.pathname}${url.search}`
  if (voiceConfigured()) {
    if (!validateTwilioVoiceSignature(validateUrl, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  const fromNumber = params.get('From') || undefined
  const callSid = params.get('CallSid') || ''
  const dialStatus = (params.get('DialCallStatus') || '').toLowerCase()
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const voicemailRouteUrl = `${baseUrl}/api/dialer/voice/twiml/voicemail`

  // Legacy-chain straggler guard: a pre-conversion in-flight call re-entering
  // via its old <Dial action> after an answered leg just ends cleanly.
  if (dialStatus === 'answered' || dialStatus === 'completed') {
    return twimlResponse(EMPTY_VOICE_TWIML)
  }

  if (!groupId || !callSid) {
    return twimlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${voicemailRouteUrl}</Redirect></Response>`
    )
  }

  const { data: dialerSettings } = await createAdminClient()
    .from('dialer_settings')
    .select('recording_enabled')
    .eq('company_id', HEROES_COMPANY_ID)
    .maybeSingle()

  const room = conferenceRoomName()
  const twiml = await connectInboundToRingGroupViaConference({
    baseUrl,
    room,
    callerCallSid: callSid,
    callerNumber: fromNumber,
    groupId,
    recordingEnabled: dialerSettings?.recording_enabled === true,
  })
  return twimlResponse(twiml)
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'dialer.voice.twiml.ring-group',
  })
}
