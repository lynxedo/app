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

// Hit by Twilio as the action target on <Dial> in /voice/twiml/inbound and
// on the per-user / IVR transfer Dials. Twilio populates DialCallStatus
// telling us what happened on the inner dial:
//   completed      — call was answered and finished normally → just hang up
//   answered       — same idea, Twilio uses both depending on flow
//   no-answer      — rang out → record voicemail
//   busy/failed/canceled — caller didn't reach an agent → record voicemail
//
// Session 60: optional `owner` query param identifies which Hub user the
// voicemail should land with (their custom greeting plays, the resulting
// voicemails row gets `owner_user_id` stamped). When unset, falls through
// to the general company greeting + null owner.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const reqUrl = new URL(request.url)
  const ownerUserId = reqUrl.searchParams.get('owner') || ''

  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}${reqUrl.pathname}${reqUrl.search}`
  if (voiceConfigured()) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  const dialStatus = (params.get('DialCallStatus') || '').toLowerCase()
  const dialed = dialStatus === 'completed' || dialStatus === 'answered'

  if (dialed) {
    // Call connected and ended normally — no voicemail needed.
    return twimlResponse(EMPTY_VOICE_TWIML)
  }

  // Falling through to voicemail. Resolve greeting per owner if set, else company.
  const admin = createAdminClient()
  let greetingUrl: string | null = null
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
  }
  if (!greetingUrl) {
    const { data: settings } = await admin
      .from('dialer_settings')
      .select('fallback_voicemail_url')
      .eq('company_id', HEROES_COMPANY_ID)
      .single()
    if (!ownerUserId) {
      greetingUrl = settings?.fallback_voicemail_url || null
    }
    // If owner has no per-user greeting we still keep the spoken fallback over
    // the company audio — per-user voicemail should sound personal.
  }

  // Carry the owner through to /voicemail/complete so the row stamps it.
  const completeUrl = ownerUserId
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/voicemail/complete?owner=${encodeURIComponent(ownerUserId)}`
    : `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/voicemail/complete`

  return twimlResponse(
    twimlRecordVoicemail({
      action: completeUrl,
      greetingUrl,
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
