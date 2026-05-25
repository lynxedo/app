import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  EMPTY_VOICE_TWIML,
  twimlDialClient,
  twimlSayAndHangup,
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

// Twilio webhook target for inbound voice — configured on the Twilio
// phone number's Voice webhook. When PSTN dials our Twilio number, Twilio
// POSTs here.
//
// v1 routing (per Ben): route to a single configured user
// (dialer_settings.inbound_route_user_id). IVR + ring groups land in a
// follow-up session. If no user is configured or that user isn't reachable,
// fall back to a polite hangup so missed calls still log.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/twiml/inbound`
  if (voiceConfigured() && signature) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  const fromNumber = params.get('From') || ''
  const toNumber = params.get('To') || ''
  const callSid = params.get('CallSid') || ''

  // Log the inbound call up front. Status updates land later via /voice/status.
  const admin = createAdminClient()
  try {
    // Look up contact if we have one
    let contactId: string | null = null
    if (fromNumber) {
      const { data: contact } = await admin
        .from('txt_contacts')
        .select('id')
        .eq('company_id', HEROES_COMPANY_ID)
        .eq('phone', fromNumber)
        .maybeSingle()
      contactId = contact?.id ?? null
    }

    await admin.from('calls').insert({
      company_id: HEROES_COMPANY_ID,
      twilio_call_sid: callSid || null,
      direction: 'inbound',
      from_number: fromNumber || 'unknown',
      to_number: toNumber || 'unknown',
      status: 'ringing',
      contact_id: contactId,
    })
  } catch {
    // swallow — call still proceeds
  }

  // Pull routing target. v1: single user.
  const { data: settings } = await admin
    .from('dialer_settings')
    .select('inbound_route_user_id, fallback_voicemail_url')
    .eq('company_id', HEROES_COMPANY_ID)
    .single()

  const routeToUserId = settings?.inbound_route_user_id

  const statusCb = `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/status`
  const recordingCb = `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/recording`

  if (routeToUserId) {
    return twimlResponse(
      twimlDialClient({
        identity: routeToUserId,
        callerId: fromNumber || undefined,
        timeoutSeconds: 30,
        recordCalls: false,
        recordingStatusCallback: recordingCb,
        statusCallback: statusCb,
      })
    )
  }

  // No route configured yet — polite hangup, call still logged
  return twimlResponse(
    twimlSayAndHangup(
      "Thank you for calling. We're not able to take your call right now. Please try again later."
    )
  )
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'dialer.voice.twiml.inbound',
  })
}
