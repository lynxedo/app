import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  EMPTY_VOICE_TWIML,
  startCallRecording,
  toE164,
  twimlDialClient,
  twimlDialPstn,
  twimlSayAndHangup,
  validateTwilioVoiceSignature,
  voiceCallerId,
  voiceConfigured,
} from '@/lib/twilio-voice'
import {
  addConferenceParticipant,
  sanitizeRoomName,
  twimlAgentJoinConference,
} from '@/lib/twilio-conference'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

function twimlResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

// Twilio webhook target — configured as the Voice Request URL on the Twilio
// TwiML App that the Voice JS SDK references via TWILIO_TWIML_APP_SID.
// When the SDK initiates an outbound call, Twilio POSTs here.
//
// Phase 3 (conference): the dialer now passes a client-generated `room` param.
// When present, the agent (this SDK leg) joins a <Conference> room and we
// REST-add the dialed party as the 'customer' participant — so the in-call UI
// can hold-with-music + transfer. Without a room (older client / safety), we
// fall back to the legacy point-to-point <Dial>.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const params = new URLSearchParams(raw)
  const paramObj: Record<string, string> = {}
  for (const [k, v] of params.entries()) paramObj[k] = v

  // Validate signature when configured. In dev/staging without creds, skip
  // validation rather than reject — the same pattern Session 46 uses.
  const signature = request.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/voice/twiml/outbound`
  if (voiceConfigured()) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return twimlResponse(EMPTY_VOICE_TWIML, 403)
    }
  }

  // The SDK's `device.connect({ params: { To, room } })` flows these into this
  // webhook. Identity is the user's hub_users.id from the access token.
  const toRaw = (params.get('To') || '').trim()
  const identity = params.get('From') || params.get('Caller') || ''
  const callSid = params.get('CallSid') || ''
  const txtConversationId = params.get('txt_conversation_id') || null
  const txtContactId = params.get('txt_contact_id') || null
  const room = sanitizeRoomName(params.get('room'))

  // For SDK-originated outbound calls Twilio sends `From` as "client:<hub_users.id>".
  // The calls-row FK columns (initiated_by / handled_by → hub_users.id) need a BARE
  // uuid — inserting the "client:" form throws an invalid-uuid error, and since the
  // insert is best-effort (swallowed) the calls row was NEVER written for outbound.
  // That's why outbound calls never persisted a conference row and Hold/Transfer
  // couldn't resolve them (inbound resolves the agent id server-side, so it worked).
  const actorUserId = (() => {
    const bare = identity.startsWith('client:') ? identity.slice('client:'.length) : identity
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bare) ? bare : null
  })()

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const statusCb = `${baseUrl}/api/dialer/voice/status`
  const recordingCb = `${baseUrl}/api/dialer/voice/recording`
  const confStatusCb = `${baseUrl}/api/dialer/voice/conference/status`

  const admin = createAdminClient()

  // Recording is opt-in per company (default OFF).
  let recordCalls = false
  try {
    const { data: recSettings } = await admin
      .from('dialer_settings')
      .select('recording_enabled')
      .eq('company_id', HEROES_COMPANY_ID)
      .single()
    recordCalls = recSettings?.recording_enabled === true
  } catch {
    // swallow — default to not recording
  }

  // Resolve the dialed party. Two kinds:
  //   3-digit extension → an internal Hub user (Client identity)
  //   phone number      → PSTN
  let customerTo: string        // what Twilio dials for the 'customer' participant
  let customerFrom: string      // From on that dial
  let toNumberStored: string    // what we store on the calls row

  if (/^[1-9][0-9]{2}$/.test(toRaw)) {
    const { data: owner } = await admin
      .from('user_profiles')
      .select('id')
      .eq('company_id', HEROES_COMPANY_ID)
      .eq('dialer_extension', toRaw)
      .maybeSingle()
    if (!owner) {
      return twimlResponse(twimlSayAndHangup(`Extension ${toRaw} is not assigned. Goodbye.`), 200)
    }
    customerTo = `client:${owner.id}`
    customerFrom = identity || voiceCallerId() // internal: show the caller
    toNumberStored = toRaw
  } else {
    const e164 = toE164(toRaw)
    if (!e164) {
      return twimlResponse(twimlSayAndHangup('Invalid number. Goodbye.'), 200)
    }
    customerTo = e164
    customerFrom = voiceCallerId() // PSTN: must be our owned caller ID
    toNumberStored = e164
  }

  // Best-effort calls-row insert. Failure never blocks the call.
  try {
    await admin.from('calls').insert({
      company_id: HEROES_COMPANY_ID,
      twilio_call_sid: callSid || null,
      direction: 'outbound',
      from_number: voiceCallerId() || 'app',
      to_number: toNumberStored,
      status: 'initiated',
      initiated_by: actorUserId,
      handled_by: actorUserId,
      conversation_id: txtConversationId,
      contact_id: txtContactId,
      conference_name: room || null,
    })
  } catch {
    // swallow — call still proceeds
  }

  // ---- Conference mode (Phase 3) ----
  if (room) {
    // Record the agent's leg via REST (dual-channel, full call) — same pattern
    // as inbound. The conference-level record attr on the agent TwiML is kept as
    // a backup, but its recording callback isn't reliably registered (the
    // conference is created by the REST add below, not the TwiML), so this REST
    // recording is what actually lands in call-log2 for outbound calls.
    // Fire-and-forget with built-in 21220 retries; never blocks the webhook.
    if (recordCalls && callSid) {
      startCallRecording(callSid, recordingCb).catch(() => {})
    }

    // Bring the dialed party into the room as 'customer'. Twilio dials them and
    // joins on answer; the agent joins via the TwiML we return below. This REST
    // add CREATES the conference, so it must register the conference status
    // callback (answered_at / ended_at lifecycle) — TwiML attrs can't.
    const add = await addConferenceParticipant({
      room,
      to: customerTo,
      from: customerFrom || '',
      label: 'customer',
      startConferenceOnEnter: true,
      endConferenceOnExit: true, // customer hangup ends the call cleanly
      timeoutSec: 30,
      conferenceStatusCallback: confStatusCb,
    })
    if (!add.ok) {
      console.warn('[dialer.outbound] addConferenceParticipant failed:', add.error)
      return twimlResponse(twimlSayAndHangup('Could not connect the call. Please try again.'), 200)
    }
    // Persist the real Twilio SIDs so hold/transfer act on the exact legs. The
    // agent leg = this outbound webhook's CallSid (the SDK call). The customer
    // leg + the conference SID come back from the participant create.
    try {
      await admin
        .from('calls')
        .update({
          conference_sid: add.conferenceSid,
          conference_agent_sid: callSid || null,
          conference_customer_sid: add.callSid,
        })
        .eq('company_id', HEROES_COMPANY_ID)
        .eq('twilio_call_sid', callSid)
    } catch {
      // swallow — call still connects; transfer/hold would just fall back to lookup
    }
    return twimlResponse(
      twimlAgentJoinConference({
        room,
        label: 'agent',
        endConferenceOnExit: true, // flipped to false by the transfer endpoint on drop
        record: recordCalls,
        recordingStatusCallback: recordingCb,
        statusCallback: confStatusCb,
        callerId: voiceCallerId() || undefined,
      })
    )
  }

  // ---- Legacy point-to-point fallback (no room — older client) ----
  if (customerTo.startsWith('client:')) {
    return twimlResponse(
      twimlDialClient({
        identity: customerTo.slice('client:'.length),
        callerId: identity || undefined,
        timeoutSeconds: 25,
        statusCallback: statusCb,
      })
    )
  }
  return twimlResponse(
    twimlDialPstn({
      to: customerTo,
      callerId: voiceCallerId(),
      timeoutSeconds: 30,
      recordCalls,
      recordingStatusCallback: recordingCb,
      statusCallback: statusCb,
    })
  )
}

// Allow Twilio's URL verification GET (Twilio sometimes pings for connectivity).
export async function GET() {
  return NextResponse.json({
    ok: true,
    twilio_configured: voiceConfigured(),
    route: 'dialer.voice.twiml.outbound',
  })
}
