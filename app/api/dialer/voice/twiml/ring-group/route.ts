import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  EMPTY_VOICE_TWIML,
  twimlRingGroupSequentialStep,
  twimlRingGroupSimultaneous,
  validateTwilioVoiceSignature,
  voiceConfigured,
} from '@/lib/twilio-voice'
import { resolveRingGroupAvailableMembers } from '@/lib/dialer-conference-connect'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

function twimlResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

function redirectToVoicemail(baseUrl: string): string {
  // Company voicemail box (no owner param). Reached as a <Redirect>, so the
  // voicemail route sees no DialCallStatus and records straight away.
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${baseUrl}/api/dialer/voice/twiml/voicemail</Redirect></Response>`
}

// Ring-group handler — classic <Dial> pattern (NOT a conference). Every
// ring_group IVR action redirects here (?group=X&i=0).
//
// Why not a conference: the conference model raced the caller's leg against the
// no-answer→voicemail redirect — when a member didn't answer, the conference
// collapsed and the caller dropped into dead air before the redirect landed
// (confirmed in prod: "group exhausted → voicemail" fired but the caller was
// already gone). A plain <Dial> with an action URL is the canonical, race-free
// Twilio ring-group pattern:
//   sequential  — ring available[i]; the <Dial action> re-enters here at i+1 on
//                 no-answer. When i runs past the last member → company voicemail.
//   simultaneous— ring everyone at once; the <Dial action> → company voicemail
//                 if nobody picks up.
// A member answering ends the chain (the action re-enters with
// DialCallStatus=completed → we hang up cleanly).
//
// Trade-off vs. the old conference: a group-answered call has no in-call hold /
// transfer. The single-agent inbound route + IVR transfer_user / extension dials
// keep the conference, so hold/transfer still work there.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const url = new URL(request.url)
  const groupId = url.searchParams.get('group') || ''
  const i = parseInt(url.searchParams.get('i') || '0', 10) || 0

  const signature = request.headers.get('x-twilio-signature')
  const validateUrl = `${process.env.NEXT_PUBLIC_APP_URL}${url.pathname}${url.search}`
  if (voiceConfigured()) {
    if (!validateTwilioVoiceSignature(validateUrl, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const dialStatus = (params.get('DialCallStatus') || '').toLowerCase()
  const fromNumber = params.get('From') || undefined
  const callSid = params.get('CallSid') || ''

  // Re-entered via the <Dial action> after a member ANSWERED and the call ended
  // → nothing left to do.
  if (dialStatus === 'answered' || dialStatus === 'completed') {
    return twimlResponse(EMPTY_VOICE_TWIML)
  }

  if (!groupId) {
    return twimlResponse(redirectToVoicemail(baseUrl))
  }

  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('dialer_settings')
    .select('recording_enabled')
    .eq('company_id', HEROES_COMPANY_ID)
    .maybeSingle()
  const recordingEnabled = settings?.recording_enabled === true
  const recordingCb = `${baseUrl}/api/dialer/voice/recording`

  // Record from answer (dual channel) when enabled — inject into the <Dial>.
  const injectRecording = (twiml: string): string =>
    recordingEnabled
      ? twiml.replace(
          /<Dial(\s)/,
          `<Dial record="record-from-answer-dual" recordingStatusCallback="${recordingCb}" recordingStatusCallbackMethod="POST"$1`
        )
      : twiml

  const { group, available } = await resolveRingGroupAvailableMembers(admin, groupId)
  if (!group || available.length === 0) {
    // No group / no members / everyone DND → company voicemail.
    console.log('[dialer.ring-group] no available members → voicemail', { groupId, callSid })
    return twimlResponse(redirectToVoicemail(baseUrl))
  }

  if (group.ring_mode === 'simultaneous') {
    console.log('[dialer.ring-group] simultaneous ring', { groupId, count: available.length, callSid })
    return twimlResponse(
      injectRecording(
        twimlRingGroupSimultaneous({
          identities: available.map((m) => m.user_id),
          callerId: fromNumber,
          timeoutSec: group.ring_timeout_sec ?? 25,
          // None answer → record a company voicemail.
          actionUrl: `${baseUrl}/api/dialer/voice/twiml/voicemail`,
        })
      )
    )
  }

  // Sequential. Ring member i; the action re-enters at i+1 on no-answer.
  if (i >= available.length) {
    console.log('[dialer.ring-group] sequential exhausted → voicemail', { groupId, i, callSid })
    return twimlResponse(redirectToVoicemail(baseUrl))
  }
  const member = available[i]
  console.log('[dialer.ring-group] sequential ring', { groupId, i, user: member.user_id, callSid })
  const nextStepUrl = `${baseUrl}/api/dialer/voice/twiml/ring-group?group=${encodeURIComponent(groupId)}&i=${i + 1}`
  return twimlResponse(
    injectRecording(
      twimlRingGroupSequentialStep({
        identity: member.user_id,
        callerId: fromNumber,
        timeoutSec: member.member_timeout_sec ?? 20,
        nextStepUrl,
      })
    )
  )
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'dialer.voice.twiml.ring-group',
  })
}
