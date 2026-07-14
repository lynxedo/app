import { NextRequest, NextResponse } from 'next/server'
import {
  EMPTY_VOICE_TWIML,
  twimlDialCellStep,
  twimlRecordVoicemail,
  twimlRingGroupSimultaneous,
  validateTwilioVoiceSignature,
  voiceCallerId,
  voiceConfigured,
} from '@/lib/twilio-voice'
import { createAdminClient } from '@/lib/supabase/admin'
import { filterNonDndUserIds } from '@/lib/dialer-conference-connect'
import { getCompanyVoicemailGreeting, getEffectiveVoiceReceptionistSettings } from '@/lib/voice-receptionist-settings'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// AI Voice Receptionist — ConversationRelay <Connect action=...> fallback.
//
// Twilio POSTs here when the <Connect><ConversationRelay> ends — including when
// the WS socket drops or the relay errors out. Rather than dead-air the caller,
// fall back to the standard voicemail flow (records + stores + queues + notifies
// via the existing /api/dialer/voice/voicemail/complete pipeline).

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

  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/voice/twiml/fallback`
  if (voiceConfigured()) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  // Twilio hits this <Connect action> URL whenever the ConversationRelay session
  // ends — INCLUDING a normal, completed call. When the assistant finished on its
  // own it already said goodbye and we sent `end` with reason 'assistant_complete',
  // so just hang up cleanly. Only genuine drops/errors (no or non-complete
  // handoff) should fall through to voicemail.
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(paramObj)) lower[k.toLowerCase()] = v
  let endReason = ''
  try {
    endReason = lower.handoffdata ? String(JSON.parse(lower.handoffdata).reason || '') : ''
  } catch {
    endReason = ''
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  // Voicemail using the company's NORMAL recorded greeting (the same one a
  // missed call hears); only falls back to the spoken line if no greeting is set.
  const voicemail = async (spokenFallback: string): Promise<string> => {
    const g = await getCompanyVoicemailGreeting(createAdminClient(), HEROES_COMPANY_ID)
    return twimlRecordVoicemail({
      action: `${baseUrl}/api/dialer/voice/voicemail/complete`,
      greetingUrl: g.url,
      greetingTts: g.tts,
      spokenFallback,
    })
  }

  if (endReason === 'assistant_complete') {
    return twimlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>')
  }

  // The caller wants a live person (Amber handed off with [[TRANSFER]]). Run the
  // configured transfer method. This TwiML executes on the CALLER's leg, so a
  // <Dial> here bridges them to whoever answers; <Dial action> falls through to
  // voicemail on no-answer. All three methods (softphone / cell / Hub-DM) are
  // implemented below; a method with no reachable recipients falls to voicemail.
  if (endReason === 'transfer_requested') {
    const admin = createAdminClient()
    const settings = await getEffectiveVoiceReceptionistSettings(admin, HEROES_COMPANY_ID)
    const callerFrom = lower.from || ''
    if (settings.transferMethod === 'softphone' && settings.transferUserIds.length > 0) {
      // Honor Do Not Disturb: ring only recipients who aren't DND right now
      // (same checks as the dialer ring groups). Everyone DND → voicemail below.
      const identities = await filterNonDndUserIds(admin, settings.transferUserIds)
      if (identities.length > 0) {
        return twimlResponse(
          twimlRingGroupSimultaneous({
            identities,
            timeoutSec: 25,
            actionUrl: `${baseUrl}/api/voice/twiml/transfer-result`,
            callerId: callerFrom || undefined,
          })
        )
      }
    }

    // Cell method: call the transfer-list users on their cell phones, ONE AT A
    // TIME, each screened with a "press 1 to accept" whisper (so a recipient's
    // voicemail can't auto-answer). We ring the first recipient who has a number
    // on file; /api/voice/twiml/transfer-cell advances to the next on no-answer
    // and drops the caller to voicemail once the list is exhausted. callerId is
    // OUR Twilio number (this is an outbound PSTN leg).
    if (settings.transferMethod === 'cell') {
      const withCell = settings.transferUserIds
        .map((uid) => ({ uid, cell: settings.transferCellNumbers[uid] }))
        .filter((r) => Boolean(r.cell))
      // Honor Do Not Disturb here too — a DND recipient's cell shouldn't ring.
      const notDnd = await filterNonDndUserIds(admin, withCell.map((r) => r.uid))
      const recipients = withCell.filter((r) => notDnd.includes(r.uid))
      if (recipients.length > 0) {
        const callSid = lower.callsid || ''
        const { data: attempt } = await admin
          .from('voice_transfer_attempts')
          .insert({
            company_id: HEROES_COMPANY_ID,
            queue_name: `cell_${callSid || Date.now()}`,
            caller_call_sid: callSid || null,
            caller_from: callerFrom || null,
            status: 'pending',
            // Backstop expiry: ~30s per recipient we'll try + a buffer.
            expires_at: new Date(Date.now() + recipients.length * 30_000 + 30_000).toISOString(),
          })
          .select('id')
          .single()
        if (attempt?.id) {
          const first = recipients[0]
          const screenUrl = `${baseUrl}/api/voice/transfer/cell-screen?a=${attempt.id}&u=${encodeURIComponent(first.uid)}`
          const actionUrl = `${baseUrl}/api/voice/twiml/transfer-cell?a=${attempt.id}&i=1`
          return twimlResponse(
            twimlDialCellStep({
              number: first.cell,
              callerId: voiceCallerId() || undefined,
              timeoutSec: 25,
              actionUrl,
              screenUrl,
            }),
          )
        }
      }
      // No recipient has a number (or the attempt insert failed) → voicemail below.
    }

    return twimlResponse(
      await voicemail(
        "I'm sorry, I couldn't reach anyone right now. Please leave a message after the tone and a team member will get right back to you. Press pound when finished.",
      ),
    )
  }

  // The caller chose to leave a voicemail (Amber handed off with [[VOICEMAIL]]).
  // Record it through the standard voicemail pipeline, but with a friendly prompt
  // — this is a deliberate choice by the caller, not a failure to connect.
  if (endReason === 'caller_requested_voicemail') {
    return twimlResponse(
      await voicemail(
        "Go ahead and leave your message after the tone, and a team member will get back to you. Press pound when you're finished.",
      ),
    )
  }

  return twimlResponse(
    await voicemail(
      "Sorry, we had trouble connecting our assistant. Please leave a message after the beep and a team member will get back to you. Press pound when finished.",
    ),
  )
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'voice.twiml.fallback',
  })
}
