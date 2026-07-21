import { NextRequest, NextResponse } from 'next/server'
import {
  EMPTY_VOICE_TWIML,
  twimlRecordVoicemail,
  validateTwilioVoiceSignature,
  voiceConfigured,
} from '@/lib/twilio-voice'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCompanyVoicemailGreeting } from '@/lib/voice-receptionist-settings'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// AI Voice Receptionist — transfer <Dial action> result.
//
// The transfer <Dial> in /api/voice/twiml/fallback (transfer_requested) points
// its action here. Twilio POSTs the DialCallStatus when the dial finishes:
//   completed / answered → someone took the call (now hung up) → hang up cleanly
//   anything else (no-answer / busy / failed / canceled) → nobody picked up →
//     fall back to a voicemail so the caller isn't stranded.

export const runtime = 'nodejs'

function twimlResponse(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/xml' } })
}

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const signature = request.headers.get('x-twilio-signature')
  // Include the request's query string (?u=<userId>) so the signed URL Twilio
  // computed matches ours — the action URL now carries the transfer target.
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/voice/twiml/transfer-result${new URL(request.url).search}`
  if (voiceConfigured()) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  const status = (params.get('DialCallStatus') || '').toLowerCase()
  if (status === 'completed' || status === 'answered') {
    // The transfer connected to a live person. If a single known user was the
    // target (?u=), record them as who took this AI-receptionist call so the Call
    // Log shows "{Name} · via Amber" instead of just "Amber". Best-effort — never
    // block the clean hangup. CallSid here is the caller leg = calls.twilio_call_sid.
    const uid = new URL(request.url).searchParams.get('u') || ''
    const callSid = params.get('CallSid') || ''
    if (/^[0-9a-f-]{36}$/i.test(uid) && callSid) {
      try {
        await createAdminClient()
          .from('calls')
          .update({ transferred_to_user_id: uid })
          .eq('twilio_call_sid', callSid)
      } catch (err) {
        console.error('[voice.transfer-result] attribute transfer failed', err)
      }
    }
    return twimlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>')
  }

  const g = await getCompanyVoicemailGreeting(createAdminClient(), HEROES_COMPANY_ID)
  return twimlResponse(
    twimlRecordVoicemail({
      action: `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/voicemail/complete`,
      greetingUrl: g.url,
      greetingTts: g.tts,
      spokenFallback:
        "I'm sorry, no one was able to pick up right now. Please leave a message after the tone and a team member will get right back to you. Press pound when finished.",
    })
  )
}

export async function GET() {
  return NextResponse.json({ ok: true, route: 'voice.twiml.transfer-result' })
}
