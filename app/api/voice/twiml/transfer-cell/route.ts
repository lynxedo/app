import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getCompanyVoicemailGreeting,
  getEffectiveVoiceReceptionistSettings,
} from '@/lib/voice-receptionist-settings'
import { twimlDialCellStep, twimlRecordVoicemail, voiceCallerId } from '@/lib/twilio-voice'

// AI Voice Receptionist — cell transfer: the SEQUENCER.
//
// Twilio POSTs here (a <Dial action>) each time a recipient's cell leg ends
// without a bridge — i.e. they didn't press 1 (no answer, declined, or their
// voicemail picked up). We then:
//   • if someone DID accept (attempt status connected) → the caller was bridged
//     and that call has now ended → hang up cleanly.
//   • otherwise ring the NEXT recipient who has a number on file.
//   • once the list is exhausted → drop the caller into voicemail (company
//     greeting), same as the softphone/dm no-answer fallbacks.
//
// Public like /transfer/hold — driven by the unguessable attempt id. Ringing one
// recipient at a time (Ben's choice) means no race, but we still key "was it
// taken?" off the attempt row (set by /cell-accept), never off DialCallStatus,
// which is ambiguous once a screened leg has answered.

export const runtime = 'nodejs'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

function xml(body: string) {
  return new NextResponse(body, { status: 200, headers: { 'Content-Type': 'text/xml' } })
}
const HANGUP = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>'

async function handle(req: NextRequest): Promise<NextResponse> {
  const u = new URL(req.url)
  const attemptId = u.searchParams.get('a') || ''
  const idx = parseInt(u.searchParams.get('i') || '0', 10) || 0
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || u.origin
  if (!attemptId) return xml(HANGUP)

  const admin = createAdminClient()
  const { data: a } = await admin
    .from('voice_transfer_attempts')
    .select('id, status')
    .eq('id', attemptId)
    .maybeSingle()

  // Someone took it → the caller was bridged and that call has ended. Done.
  if (a && (a.status === 'accepted' || a.status === 'connected')) {
    return xml(HANGUP)
  }

  // Advance to the next recipient with a number on file (stable order, rebuilt
  // from settings each step).
  const settings = await getEffectiveVoiceReceptionistSettings(admin, HEROES_COMPANY_ID)
  const recipients = settings.transferUserIds
    .map((uid) => ({ uid, cell: settings.transferCellNumbers[uid] }))
    .filter((r) => Boolean(r.cell))

  if (settings.transferMethod === 'cell' && idx < recipients.length) {
    const next = recipients[idx]
    const screenUrl = `${baseUrl}/api/voice/transfer/cell-screen?a=${attemptId}&u=${encodeURIComponent(next.uid)}`
    const actionUrl = `${baseUrl}/api/voice/twiml/transfer-cell?a=${attemptId}&i=${idx + 1}`
    return xml(
      twimlDialCellStep({
        number: next.cell,
        callerId: voiceCallerId() || undefined,
        timeoutSec: 25,
        actionUrl,
        screenUrl,
      }),
    )
  }

  // Exhausted — nobody took the call. Mark the attempt + drop to voicemail.
  if (a && a.status === 'pending') {
    await admin.from('voice_transfer_attempts').update({ status: 'timed_out' }).eq('id', attemptId)
  }
  const g = await getCompanyVoicemailGreeting(admin, HEROES_COMPANY_ID)
  return xml(
    twimlRecordVoicemail({
      action: `${baseUrl}/api/dialer/voice/voicemail/complete`,
      greetingUrl: g.url,
      greetingTts: g.tts,
      spokenFallback:
        "I'm sorry, no one was able to pick up right now. Please leave a message after the tone and a team member will get right back to you. Press pound when finished.",
    }),
  )
}

export async function POST(req: NextRequest) {
  return handle(req)
}
export async function GET(req: NextRequest) {
  return handle(req)
}
