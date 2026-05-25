import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  EMPTY_VOICE_TWIML,
  twimlDialClient,
  twimlRecordVoicemail,
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
// v1 routing (per Ben): try to route to a single configured user
// (dialer_settings.inbound_route_user_id) for ring_timeout_sec seconds. If
// unanswered OR no user configured, fall through to general voicemail. IVR +
// ring groups + per-user boxes land in Sessions 59–60.
//
// <Dial action="..."> is hit by Twilio when the dial finishes — with
// DialCallStatus indicating answered/no-answer/busy/failed/etc. The
// /voice/twiml/voicemail render endpoint reads that status and either ends
// the call cleanly (answered) or records a voicemail (everything else).
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

  // Log the inbound call up front. Status updates land later via /voice/status
  // (Twilio's separate Status Callback on the parent call) and the voicemail
  // render route (Dial action).
  const admin = createAdminClient()
  try {
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

  const { data: settings } = await admin
    .from('dialer_settings')
    .select('inbound_route_user_id, ring_timeout_sec')
    .eq('company_id', HEROES_COMPANY_ID)
    .single()

  const routeToUserId = settings?.inbound_route_user_id
  const ringTimeout = settings?.ring_timeout_sec ?? 20

  const voicemailRender = `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/twiml/voicemail`

  if (routeToUserId) {
    return twimlResponse(
      twimlDialClient({
        identity: routeToUserId,
        callerId: fromNumber || undefined,
        timeoutSeconds: ringTimeout,
        statusCallback: voicemailRender,
      })
    )
  }

  // No route configured — go straight to general voicemail. We need to fetch
  // the greeting URL here since this branch skips the Dial-then-render path.
  const { data: vmSettings } = await admin
    .from('dialer_settings')
    .select('fallback_voicemail_url')
    .eq('company_id', HEROES_COMPANY_ID)
    .single()

  return twimlResponse(
    twimlRecordVoicemail({
      action: `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/voicemail/complete`,
      greetingUrl: vmSettings?.fallback_voicemail_url || null,
      spokenFallback:
        "Thanks for calling. Please leave a message after the beep and we'll get back to you. Press pound when finished.",
    })
  )
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'dialer.voice.twiml.inbound',
  })
}
