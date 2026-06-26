import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  EMPTY_VOICE_TWIML,
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

// Renders the voicemail prompt + <Record>. Reached two ways:
//   1. As the <Dial action> on a conference caller leg (URL carries ?via=conf).
//   2. Via <Redirect> from the IVR / ring-group / explicit "send to voicemail"
//      paths (no DialCallStatus).
//
// Answered vs. not — when do we hang up instead of recording?
//   A <Dial><Conference> action ALWAYS reports DialCallStatus=completed when the
//   caller's conference leg ends, regardless of whether anyone actually answered
//   (the conference simply "completed"). So for conference legs (?via=conf) the
//   DialCallStatus is meaningless — we instead read the calls row's answered_at,
//   which the conference status callback stamps only on a real participant join.
//   For a direct <Dial><Number>/<Client> action (transfer_pstn, legacy
//   point-to-point) DialCallStatus IS reliable, so we use it there.
//   This is what fixes "the call never reaches voicemail when nobody answers":
//   the conference collapses when the last rung leg ends → the caller's Dial
//   action fires here with DialCallStatus=completed → we now correctly detect
//   answered_at IS NULL and record a voicemail instead of hanging up.
//
// Greeting policy (Ben, June 26 2026):
//   - Business calls (inbound routing, IVR menus, ring groups) → the COMPANY
//     voicemail greeting (dialer_settings.fallback_voicemail_url / _tts). These
//     paths pass NO `owner` param.
//   - An extension dialed (internally, or by a caller entering it at the IVR) →
//     that user's PERSONAL greeting. Those paths pass ?owner=<userId>.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const reqUrl = new URL(request.url)
  const ownerUserId = reqUrl.searchParams.get('owner') || ''
  const via = reqUrl.searchParams.get('via') || ''

  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}${reqUrl.pathname}${reqUrl.search}`
  if (voiceConfigured()) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  const admin = createAdminClient()

  // Did a human actually answer? If so, hang up cleanly — no voicemail.
  const dialStatus = (params.get('DialCallStatus') || '').toLowerCase()
  const callerSid = params.get('CallSid') || ''
  let answered = false
  if (via === 'conf') {
    if (callerSid) {
      const { data: row } = await admin
        .from('calls')
        .select('answered_at')
        .eq('twilio_call_sid', callerSid)
        .maybeSingle()
      answered = !!row?.answered_at
    }
  } else {
    answered = dialStatus === 'completed' || dialStatus === 'answered'
  }

  if (answered) {
    return twimlResponse(EMPTY_VOICE_TWIML)
  }

  // Resolve the greeting. Per-user only when an extension was dialed (owner set);
  // otherwise the company greeting — uploaded audio first, then typed TTS, then a
  // spoken default.
  let greetingUrl: string | null = null
  let greetingTts: string | null = null
  let spokenFallback =
    "Thanks for calling. Please leave a message after the beep and we'll get back to you. Press pound when finished."

  if (ownerUserId) {
    const [{ data: profile }, { data: hu }] = await Promise.all([
      admin
        .from('user_profiles')
        .select('voicemail_greeting_url')
        .eq('id', ownerUserId)
        .maybeSingle(),
      admin
        .from('hub_users')
        .select('display_name')
        .eq('id', ownerUserId)
        .maybeSingle(),
    ])
    greetingUrl = profile?.voicemail_greeting_url || null
    if (!greetingUrl && hu?.display_name) {
      spokenFallback = `You've reached ${hu.display_name}. Please leave a message after the beep. Press pound when finished.`
    }
    // Per-user voicemail stays personal — never fall back to the company audio/TTS.
  } else {
    const { data: settings } = await admin
      .from('dialer_settings')
      .select('fallback_voicemail_url, fallback_voicemail_tts')
      .eq('company_id', HEROES_COMPANY_ID)
      .single()
    greetingUrl = settings?.fallback_voicemail_url || null
    greetingTts = settings?.fallback_voicemail_tts || null
  }

  // Carry the owner through to /voicemail/complete so the row stamps it.
  const completeUrl = ownerUserId
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/voicemail/complete?owner=${encodeURIComponent(ownerUserId)}`
    : `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/voicemail/complete`

  return twimlResponse(
    twimlRecordVoicemail({
      action: completeUrl,
      greetingUrl,
      greetingTts,
      spokenFallback,
    })
  )
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'dialer.voice.twiml.voicemail',
  })
}
