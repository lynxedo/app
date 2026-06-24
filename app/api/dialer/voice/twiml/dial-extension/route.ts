import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  DEFAULT_RECORDING_CONSENT_NOTICE,
  EMPTY_VOICE_TWIML,
  validateTwilioVoiceSignature,
  voiceConfigured,
} from '@/lib/twilio-voice'
import { buildIvrContext } from '@/lib/dialer-ivr-context'
import { conferenceRoomName } from '@/lib/twilio-conference'
import { connectInboundToAgentViaConference, isAgentDndNow } from '@/lib/dialer-conference-connect'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

function twimlResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Dial-by-extension handler. The IVR's `dial_by_extension` action renders a
// <Gather> that POSTs the caller's entered extension here. We resolve it to a
// Hub user and connect through the same conference path the IVR's fixed
// `extension` action uses (so hold/transfer still work). Unrecognized or empty
// input re-prompts once (r=1), then drops to the company general voicemail.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const url = new URL(request.url)
  const retry = parseInt(url.searchParams.get('r') || '0', 10) || 0

  const signature = request.headers.get('x-twilio-signature')
  const validateUrl = `${process.env.NEXT_PUBLIC_APP_URL}${url.pathname}${url.search}`
  if (voiceConfigured()) {
    if (!validateTwilioVoiceSignature(validateUrl, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const voicemailRouteUrl = `${baseUrl}/api/dialer/voice/twiml/voicemail`
  // Strip the finishOnKey '#' and any stray non-digits before resolving.
  const digits = (params.get('Digits') || '').replace(/[^0-9]/g, '')
  const fromNumber = params.get('From') || undefined
  const callSid = params.get('CallSid') || ''

  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('dialer_settings')
    .select('recording_enabled, recording_consent_notice, ring_timeout_sec')
    .eq('company_id', HEROES_COMPANY_ID)
    .single()

  const ctx = await buildIvrContext(admin, HEROES_COMPANY_ID)
  const resolved = digits ? ctx.extensionResolver(digits) : null

  if (resolved && callSid) {
    // Recognized extension. If the owner is DND right now, don't ring — send the
    // caller to that person's voicemail box. Otherwise connect via conference.
    const dnd = await isAgentDndNow(admin, resolved.ownerUserId)
    if (dnd) {
      return twimlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${escapeXmlAttr(ctx.perUserVoicemailUrlFor(resolved.ownerUserId))}</Redirect></Response>`
      )
    }
    const room = conferenceRoomName()
    // Stamp the room + answering user on the calls row so the web/native dialer
    // can discover its conference (enables in-call hold + transfer), mirroring
    // the IVR route's transfer_user/extension connect.
    await admin
      .from('calls')
      .update({ conference_name: room, handled_by: resolved.ownerUserId })
      .eq('company_id', HEROES_COMPANY_ID)
      .eq('twilio_call_sid', callSid)
    const twiml = await connectInboundToAgentViaConference({
      baseUrl,
      room,
      callerCallSid: callSid,
      callerNumber: fromNumber,
      agentIdentity: resolved.identity,
      voicemailOwnerUserId: resolved.ownerUserId,
      ringTimeoutSec: settings?.ring_timeout_sec ?? 20,
      recordingEnabled: settings?.recording_enabled === true,
      recordingConsentNotice: settings?.recording_consent_notice || DEFAULT_RECORDING_CONSENT_NOTICE,
    })
    return twimlResponse(twiml)
  }

  // Unrecognized or empty. Re-prompt once, then give up to general voicemail.
  if (retry < 1) {
    const gatherUrl = ctx.dialExtensionUrlFor(retry + 1)
    const attrs = [
      'input="dtmf"',
      'numDigits="3"',
      'finishOnKey="#"',
      'timeout="6"',
      `action="${escapeXmlAttr(gatherUrl)}"`,
      'method="POST"',
      'actionOnEmptyResult="true"',
    ].join(' ')
    return twimlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Gather ${attrs}><Say voice="alice">Sorry, I didn't recognize that extension. Please enter it again, or stay on the line.</Say></Gather><Redirect method="POST">${escapeXmlAttr(voicemailRouteUrl)}</Redirect></Response>`
    )
  }

  return twimlResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${escapeXmlAttr(voicemailRouteUrl)}</Redirect></Response>`
  )
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'dialer.voice.twiml.dial-extension',
  })
}
