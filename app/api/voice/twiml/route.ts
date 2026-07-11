import { NextRequest, NextResponse } from 'next/server'
import {
  BusinessHoursSchedule,
  EMPTY_VOICE_TWIML,
  isWithinBusinessHours,
  twimlRecordVoicemail,
  validateTwilioVoiceSignature,
  voiceConfigured,
} from '@/lib/twilio-voice'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildConversationRelayTwiml } from '@/lib/voice-receptionist'
import { getEffectiveVoiceReceptionistSettings } from '@/lib/voice-receptionist-settings'

// Phase 1a is single-tenant (Heroes). Reuses the same company-id constant the
// dialer/brain voice routes use.
const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// AI Voice Receptionist — standalone inbound voice webhook (Phase 1a).
//
// This is a DIRECT entry point: point a Twilio number's Voice webhook here to
// send every inbound call straight to the ConversationRelay AI receptionist,
// bypassing the dialer IVR entirely. Used for isolated testing (e.g. the 888
// backup number) before enabling the gated after-hours branch inside the main
// dialer inbound route.
//
// (The production trigger for Heroes' primary line lives in
// app/api/dialer/voice/twiml/inbound/route.ts, gated on AI_RECEPTIONIST_ENABLED
// + an after-hours/holiday IVR tree.)

export const runtime = 'nodejs'

function twimlResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  // Validate the Twilio signature exactly as the dialer inbound routes do.
  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/voice/twiml`
  if (voiceConfigured()) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin

  // Load the company's editable receptionist settings (Admin -> Dialer -> AI
  // Receptionist). When the admin has turned the receptionist OFF, do NOT hand
  // the caller to the AI — fall back to the standard voicemail flow instead.
  const admin = createAdminClient()
  const settings = await getEffectiveVoiceReceptionistSettings(admin, HEROES_COMPANY_ID)

  if (!settings.enabled) {
    return twimlResponse(
      twimlRecordVoicemail({
        action: `${baseUrl}/api/dialer/voice/voicemail/complete`,
        spokenFallback:
          "Thanks for calling. Please leave a message after the beep and we'll get back to you. Press pound when finished.",
      })
    )
  }

  // Pick the greeting by context: during business hours the team is "helping
  // other customers"; outside them they're "not available". Reuses the dialer's
  // own business-hours schedule so the two stay consistent.
  const { data: ds } = await admin
    .from('dialer_settings')
    .select('business_hours')
    .eq('company_id', HEROES_COMPANY_ID)
    .maybeSingle()
  const inHours = isWithinBusinessHours((ds?.business_hours as BusinessHoursSchedule | null) ?? null)
  const greeting = inHours ? settings.greetingBusinessHours : settings.greetingAfterHours

  return twimlResponse(
    buildConversationRelayTwiml({
      baseUrl,
      wssUrl: process.env.VOICE_WSS_URL || '',
      wsKey: process.env.VOICE_WS_SECRET || '',
      voiceId: settings.voiceId,
      greeting,
    })
  )
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'voice.twiml',
  })
}
