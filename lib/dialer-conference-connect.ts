// Inbound conference connect — shared by the inbound route (single configured
// user) and the IVR route (transfer_user / extension). Puts the CALLER into a
// <Conference> on hold music and REST-adds the chosen Hub user as the 'agent'
// participant. If the agent doesn't answer within the ring timeout, the agent
// participant's status callback (/conference/agent-status) redirects the caller
// to voicemail — preserving the legacy no-answer → voicemail behavior in the
// conference world, while unlocking in-call hold + transfer for inbound calls.

import {
  addConferenceParticipant,
  twimlCustomerJoinConference,
} from '@/lib/twilio-conference'
import {
  injectConsentNotice,
  twimlRecordVoicemail,
  voiceCallerId,
} from '@/lib/twilio-voice'
import { createAdminClient } from '@/lib/supabase/admin'

const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

export async function connectInboundToAgentViaConference(opts: {
  baseUrl: string
  room: string
  callerCallSid: string
  callerNumber?: string
  agentIdentity: string          // the Hub user id (we dial client:<id>)
  voicemailOwnerUserId?: string  // whose greeting plays if the agent never answers
  ringTimeoutSec: number
  recordingEnabled: boolean
  recordingConsentNotice?: string
}): Promise<string> {
  const {
    baseUrl, room, callerCallSid, callerNumber, agentIdentity,
    voicemailOwnerUserId, ringTimeoutSec, recordingEnabled, recordingConsentNotice,
  } = opts

  const holdMusic = `${baseUrl}/api/dialer/voice/twiml/hold-music`
  const recordingCb = `${baseUrl}/api/dialer/voice/recording`
  const confStatusCb = `${baseUrl}/api/dialer/voice/conference/status`
  const ownerQs = voicemailOwnerUserId ? `&owner=${encodeURIComponent(voicemailOwnerUserId)}` : ''
  const voicemailRender = `${baseUrl}/api/dialer/voice/twiml/voicemail${voicemailOwnerUserId ? `?owner=${encodeURIComponent(voicemailOwnerUserId)}` : ''}`
  const agentStatusCb =
    `${baseUrl}/api/dialer/voice/conference/agent-status?caller_sid=${encodeURIComponent(callerCallSid)}&room=${encodeURIComponent(room)}${ownerQs}`

  // Ring the agent into the room. From = the caller's number so the agent sees
  // who's calling (cosmetic for a Client leg). Timeout drives the ring duration.
  const add = await addConferenceParticipant({
    room,
    to: `client:${agentIdentity}`,
    from: callerNumber || voiceCallerId() || '',
    label: 'agent',
    startConferenceOnEnter: true,
    endConferenceOnExit: true, // agent hangup ends the call; flipped false on transfer
    timeoutSec: ringTimeoutSec,
    statusCallback: agentStatusCb,
  })

  // Persist the real Twilio SIDs so hold/transfer act on the exact legs. The
  // customer leg = the caller's CallSid (the inbound call this row was created
  // for); the agent leg + conference SID come back from the participant create.
  if (add.ok) {
    try {
      await createAdminClient()
        .from('calls')
        .update({
          conference_sid: add.conferenceSid,
          conference_agent_sid: add.callSid,
          conference_customer_sid: callerCallSid,
        })
        .eq('company_id', HEROES_COMPANY_ID)
        .eq('twilio_call_sid', callerCallSid)
    } catch {
      // swallow — call still connects
    }
  }

  // If we couldn't even ring the agent, don't strand the caller on hold music —
  // send them straight to voicemail.
  if (!add.ok) {
    let vm = twimlRecordVoicemail({
      action: `${baseUrl}/api/dialer/voice/voicemail/complete${voicemailOwnerUserId ? `?owner=${encodeURIComponent(voicemailOwnerUserId)}` : ''}`,
      greetingUrl: null,
      spokenFallback: "Thanks for calling. Please leave a message after the beep. Press pound when finished.",
    })
    if (recordingEnabled && recordingConsentNotice) vm = injectConsentNotice(vm, recordingConsentNotice)
    return vm
  }

  // Caller joins + waits on hold music until the agent enters. The <Dial action>
  // lands a normally-ended call cleanly (voicemail route returns empty when
  // DialCallStatus=completed) and is a backstop voicemail otherwise.
  let twiml = twimlCustomerJoinConference({
    room,
    waitUrl: holdMusic,
    action: voicemailRender,
    record: recordingEnabled,
    recordingStatusCallback: recordingCb,
    statusCallback: confStatusCb,
  })
  if (recordingEnabled && recordingConsentNotice) twiml = injectConsentNotice(twiml, recordingConsentNotice)
  return twiml
}
