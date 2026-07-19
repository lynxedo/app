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
import { buildConversationRelayTwiml, buildWelcomeGreeting } from '@/lib/voice-receptionist'
import { getCompanyVoicemailGreeting, getEffectiveVoiceReceptionistSettings } from '@/lib/voice-receptionist-settings'
import { resolveCompanyByTwilioNumber } from '@/lib/txt-company'

// Env-pinned fallback company (single-tenant default). Multi-tenant Track 3
// resolves the real company per inbound `To` below; this only applies when the
// destination number isn't in txt_phone_numbers — preserving today's behavior.
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

  // Multi-tenant Track 3 — resolve the owning company from the destination
  // number (`To`) via txt_phone_numbers before any per-company fetch. Not found
  // → fall back to the env-pinned default AND warn, so an unlisted number can
  // never misroute or drop the call. For Heroes (its numbers are in the table)
  // this resolves to the SAME company id the env pin produced.
  const toNumber = params.get('To') || ''
  const resolvedCompany = toNumber ? await resolveCompanyByTwilioNumber(toNumber) : null
  if (toNumber && !resolvedCompany) {
    console.warn('[voice:twiml] no company mapping for To — using env default', { toNumber })
  }
  const companyId = resolvedCompany?.companyId || HEROES_COMPANY_ID

  // Load the company's editable receptionist settings (Admin -> Dialer -> AI
  // Receptionist). When the admin has turned the receptionist OFF, do NOT hand
  // the caller to the AI — fall back to the standard voicemail flow instead.
  const admin = createAdminClient()
  const settings = await getEffectiveVoiceReceptionistSettings(admin, companyId)

  if (!settings.enabled) {
    const g = await getCompanyVoicemailGreeting(admin, companyId)
    return twimlResponse(
      twimlRecordVoicemail({
        action: `${baseUrl}/api/dialer/voice/voicemail/complete`,
        greetingUrl: g.url,
        greetingTts: g.tts,
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
    .eq('company_id', companyId)
    .maybeSingle()
  const inHours = isWithinBusinessHours((ds?.business_hours as BusinessHoursSchedule | null) ?? null)

  // Test-line override (mirrors /api/voice/brain): when the test number is called
  // with VOICE_TEST_LEVEL=5, open with the FRONTLINE greeting (front-desk, no
  // "team isn't available" line) so the welcome matches how the brain behaves on
  // that call — without changing the company's stored level or the live line.
  // (`toNumber` is resolved once above and reused here.)
  const testNumber = (process.env.VOICE_TEST_NUMBER || '').trim()
  const testFrontline = Boolean(testNumber && toNumber === testNumber && Math.round(Number(process.env.VOICE_TEST_LEVEL)) === 5)
  const greeting = testFrontline
    ? buildWelcomeGreeting(5, { name: settings.receptionistName })
    : inHours
      ? settings.greetingBusinessHours
      : settings.greetingAfterHours

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
