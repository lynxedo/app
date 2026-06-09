import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { EMPTY_VOICE_TWIML, validateTwilioVoiceSignature, voiceConfigured } from '@/lib/twilio-voice'

const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

function xml(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/xml' } })
}

// Conference status callback — referenced as statusCallback on the agent's
// <Conference>. Twilio POSTs lifecycle events; we mirror the ones that matter
// for the call log onto the matching calls row (keyed by FriendlyName = room).
//
// Best-effort: a failed DB write never affects the live call.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/conference/status`
  if (voiceConfigured() && signature) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return xml(EMPTY_VOICE_TWIML, 403)
    }
  }

  const event = params.get('StatusCallbackEvent') || ''
  const room = params.get('FriendlyName') || ''
  if (!room) return xml(EMPTY_VOICE_TWIML)

  const admin = createAdminClient()
  try {
    if (event === 'conference-start' || event === 'participant-join') {
      // First real bridge — stamp answered_at once.
      await admin
        .from('calls')
        .update({ status: 'in-progress', answered_at: new Date().toISOString() })
        .eq('company_id', HEROES_COMPANY_ID)
        .eq('conference_name', room)
        .is('answered_at', null)
    } else if (event === 'conference-end') {
      await admin
        .from('calls')
        .update({ status: 'completed', ended_at: new Date().toISOString() })
        .eq('company_id', HEROES_COMPANY_ID)
        .eq('conference_name', room)
        .is('ended_at', null)
    }
  } catch {
    // swallow — call lifecycle is unaffected
  }

  return xml(EMPTY_VOICE_TWIML)
}

export async function GET() {
  return NextResponse.json({ ok: true, route: 'dialer.voice.conference.status' })
}
