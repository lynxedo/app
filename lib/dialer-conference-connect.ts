// Inbound conference connect — shared by the inbound route (single configured
// user) and the IVR route (transfer_user / extension). Puts the CALLER into a
// <Conference> on hold music and REST-adds the chosen Hub user as the 'agent'
// participant. If the agent doesn't answer within the ring timeout, the agent
// participant's status callback (/conference/agent-status) redirects the caller
// to voicemail — preserving the legacy no-answer → voicemail behavior in the
// conference world, while unlocking in-call hold + transfer for inbound calls.

import {
  addConferenceParticipant,
  cancelCall,
  fetchCallStatus,
  redirectCall,
  twimlCustomerJoinConference,
} from '@/lib/twilio-conference'
import {
  injectConsentNotice,
  isInDndSchedule,
  twimlRecordVoicemail,
  voiceCallerId,
  type DndSchedule,
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
  // This REST add CREATES the conference (it runs before the caller's TwiML leg
  // joins), so it must register the conference status callback — the TwiML
  // statusCallback attr on the caller's <Conference> is ignored by Twilio.
  const add = await addConferenceParticipant({
    room,
    to: `client:${agentIdentity}`,
    from: callerNumber || voiceCallerId() || '',
    label: 'agent',
    startConferenceOnEnter: true,
    endConferenceOnExit: true, // agent hangup ends the call; flipped false on transfer
    timeoutSec: ringTimeoutSec,
    statusCallback: agentStatusCb,
    conferenceStatusCallback: confStatusCb,
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

// ---------------------------------------------------------------------------
// Ring groups via conference (replaces the legacy sequential/simultaneous
// <Dial> chains, so group-answered calls get in-call hold + transfer).
//
// Model: the caller joins the conference and waits on hold music; group
// members are REST-added as participants. While legs are being rung, the
// calls row's `ring_pending` jsonb holds [{ call_sid, user_id }] for every
// live leg:
//   - the conference status callback uses it to stamp handled_by with the
//     member who actually answered, and to CANCEL sibling legs (simultaneous);
//   - the agent-status chain atomically nulls it as the claim that exactly one
//     handler sends the caller to voicemail when the group is exhausted.
//
// Sequential mode rings one member at a time: each unanswered leg's terminal
// agent-status callback adds the next available member. Simultaneous mode adds
// every available member at once (unique labels — participant labels must be
// unique per conference); first to answer wins, the rest are canceled.
// ---------------------------------------------------------------------------

export type RingPendingEntry = { call_sid: string; user_id: string }

type RingGroupInfo = {
  id: string
  ring_mode: string | null
  ring_timeout_sec: number | null
}
type RingGroupMember = { user_id: string; member_timeout_sec: number | null }

// Group + members minus anyone who is DND right now. Re-resolved at every
// sequential step (matching the legacy chain, which re-filtered per step) so
// a member flipping DND mid-ring is skipped.
export async function resolveRingGroupAvailableMembers(
  admin: ReturnType<typeof createAdminClient>,
  groupId: string
): Promise<{ group: RingGroupInfo | null; available: RingGroupMember[] }> {
  const { data: group } = await admin
    .from('dialer_ring_groups')
    .select('id, ring_mode, ring_timeout_sec')
    .eq('id', groupId)
    .maybeSingle()
  if (!group) return { group: null, available: [] }

  const { data: memberRows } = await admin
    .from('dialer_ring_group_members')
    .select('user_id, position, member_timeout_sec')
    .eq('group_id', groupId)
    .order('position')
  const members = (memberRows ?? []) as (RingGroupMember & { position: number })[]
  if (members.length === 0) return { group, available: [] }

  const memberIds = members.map(m => m.user_id)
  const [{ data: profileRows }, { data: hubStatusRows }] = await Promise.all([
    admin
      .from('user_profiles')
      .select('id, dialer_dnd_enabled, dialer_dnd_schedule')
      .in('id', memberIds),
    admin
      .from('hub_users')
      .select('id, status, status_until')
      .in('id', memberIds),
  ])
  const hubDndById = new Map<string, boolean>()
  for (const u of hubStatusRows ?? []) {
    const active = u.status === 'dnd' && (!u.status_until || new Date(u.status_until) > new Date())
    hubDndById.set(u.id, active)
  }
  const dndById = new Map<string, boolean>()
  for (const p of profileRows ?? []) {
    const sched = (p.dialer_dnd_schedule || null) as DndSchedule | null
    dndById.set(p.id, Boolean(p.dialer_dnd_enabled) || isInDndSchedule(sched) || Boolean(hubDndById.get(p.id)))
  }
  return { group, available: members.filter(m => !dndById.get(m.user_id)) }
}

// True if the given user is currently DND — checks both Hub presence status
// and Dialer DND toggle/schedule so callers on the single-user or IVR paths
// get the same treatment as ring group members.
export async function isAgentDndNow(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<boolean> {
  const [{ data: profile }, { data: hubUser }] = await Promise.all([
    admin
      .from('user_profiles')
      .select('dialer_dnd_enabled, dialer_dnd_schedule')
      .eq('id', userId)
      .maybeSingle(),
    admin
      .from('hub_users')
      .select('status, status_until')
      .eq('id', userId)
      .maybeSingle(),
  ])
  const hubDnd = hubUser?.status === 'dnd' &&
    (!hubUser.status_until || new Date(hubUser.status_until) > new Date())
  const sched = (profile?.dialer_dnd_schedule || null) as DndSchedule | null
  return hubDnd || Boolean(profile?.dialer_dnd_enabled) || isInDndSchedule(sched)
}

function voicemailRedirectTwiml(baseUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${baseUrl}/api/dialer/voice/twiml/voicemail</Redirect></Response>`
}

function groupAgentStatusCb(opts: {
  baseUrl: string
  callerCallSid: string
  room: string
  groupId: string
  mode: 'seq' | 'sim'
  nextIndex: number
}): string {
  return (
    `${opts.baseUrl}/api/dialer/voice/conference/agent-status` +
    `?caller_sid=${encodeURIComponent(opts.callerCallSid)}` +
    `&room=${encodeURIComponent(opts.room)}` +
    `&group=${encodeURIComponent(opts.groupId)}` +
    `&mode=${opts.mode}&i=${opts.nextIndex}`
  )
}

// Entry point — returns the TwiML for the CALLER's leg. Mirrors
// connectInboundToAgentViaConference but rings a group instead of one user.
export async function connectInboundToRingGroupViaConference(opts: {
  baseUrl: string
  room: string
  callerCallSid: string
  callerNumber?: string
  groupId: string
  recordingEnabled: boolean
}): Promise<string> {
  const { baseUrl, room, callerCallSid, callerNumber, groupId, recordingEnabled } = opts
  const admin = createAdminClient()

  const { group, available } = await resolveRingGroupAvailableMembers(admin, groupId)
  // No group / no members / everyone DND — straight to general voicemail,
  // exactly like the legacy route.
  if (!group || available.length === 0) return voicemailRedirectTwiml(baseUrl)

  const holdMusic = `${baseUrl}/api/dialer/voice/twiml/hold-music`
  const recordingCb = `${baseUrl}/api/dialer/voice/recording`
  const confStatusCb = `${baseUrl}/api/dialer/voice/conference/status`
  const from = callerNumber || voiceCallerId() || ''
  const simultaneous = group.ring_mode === 'simultaneous'

  const pending: RingPendingEntry[] = []
  let conferenceSid: string | null = null

  if (simultaneous) {
    const timeout = group.ring_timeout_sec ?? 25
    let n = 0
    for (const member of available) {
      n++
      const add = await addConferenceParticipant({
        room,
        to: `client:${member.user_id}`,
        from,
        // Participant labels must be unique within a conference — concurrent
        // legs can't all be 'agent'.
        label: `agent_${n}`,
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        timeoutSec: timeout,
        statusCallback: groupAgentStatusCb({ baseUrl, callerCallSid, room, groupId, mode: 'sim', nextIndex: 0 }),
        // Registered by whichever add CREATES the conference (the first).
        conferenceStatusCallback: confStatusCb,
      })
      if (add.ok && add.callSid) {
        pending.push({ call_sid: add.callSid, user_id: member.user_id })
        if (!conferenceSid && add.conferenceSid) conferenceSid = add.conferenceSid
      }
    }
  } else {
    // Sequential: ring available[0]; the no-answer callback chains to the next.
    // If an add fails outright, try the next member here so one bad leg doesn't
    // send the caller straight to voicemail (legacy parity: a failed <Dial>
    // step advanced the chain).
    for (let i = 0; i < available.length; i++) {
      const member = available[i]
      const add = await addConferenceParticipant({
        room,
        to: `client:${member.user_id}`,
        from,
        label: 'agent',
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        timeoutSec: member.member_timeout_sec ?? 20,
        statusCallback: groupAgentStatusCb({ baseUrl, callerCallSid, room, groupId, mode: 'seq', nextIndex: i + 1 }),
        conferenceStatusCallback: confStatusCb,
      })
      if (add.ok && add.callSid) {
        pending.push({ call_sid: add.callSid, user_id: member.user_id })
        conferenceSid = add.conferenceSid
        break
      }
    }
  }

  if (pending.length === 0) return voicemailRedirectTwiml(baseUrl)

  // Stamp the room + SIDs + ringing state on the calls row so the answering
  // member's hold/transfer/pause can resolve this call. handled_by is set per
  // ring for sequential (the one member being rung); for simultaneous it's
  // stamped when someone actually joins (conference status callback).
  try {
    await admin
      .from('calls')
      .update({
        conference_name: room,
        conference_sid: conferenceSid,
        conference_customer_sid: callerCallSid,
        conference_agent_sid: simultaneous ? null : pending[0].call_sid,
        handled_by: simultaneous ? null : pending[0].user_id,
        ring_pending: pending,
      })
      .eq('company_id', HEROES_COMPANY_ID)
      .eq('twilio_call_sid', callerCallSid)
  } catch {
    // swallow — call still connects
  }

  // Caller waits on hold music; consent (if any) already played at IVR entry.
  return twimlCustomerJoinConference({
    room,
    waitUrl: holdMusic,
    action: `${baseUrl}/api/dialer/voice/twiml/voicemail`,
    record: recordingEnabled,
    recordingStatusCallback: recordingCb,
    statusCallback: confStatusCb,
  })
}

// Called from the agent-status callback when a group leg ends unanswered
// (no-answer / busy / failed / canceled). Sequential: ring the next member.
// Simultaneous: if no sibling leg is still live, the group is exhausted.
// Either way, exhaustion claims the row (atomic ring_pending null-out) and
// redirects the still-waiting caller to general voicemail.
export async function advanceRingGroup(opts: {
  baseUrl: string
  room: string
  callerCallSid: string
  groupId: string
  mode: 'seq' | 'sim'
  nextIndex: number
  endedLegSid?: string
}): Promise<void> {
  const admin = createAdminClient()
  const { data: row } = await admin
    .from('calls')
    .select('id, answered_at, ring_pending, from_number')
    .eq('company_id', HEROES_COMPANY_ID)
    .eq('twilio_call_sid', opts.callerCallSid)
    .maybeSingle()

  // Someone already answered (the join handler stamps answered_at + clears
  // ring_pending) — this is just a sibling leg reporting in. Nothing to do.
  if (row?.answered_at) return
  const pending = ((row?.ring_pending as RingPendingEntry[] | null) ?? []).filter(
    p => p.call_sid !== opts.endedLegSid
  )

  // Caller gone? Stop the chain and silence any legs still ringing.
  const callerStatus = await fetchCallStatus(opts.callerCallSid)
  const callerAlive =
    callerStatus === 'queued' || callerStatus === 'ringing' || callerStatus === 'in-progress'
  if (!callerAlive) {
    for (const p of pending) {
      try { await cancelCall(p.call_sid) } catch { /* best-effort */ }
    }
    if (row) {
      await admin.from('calls').update({ ring_pending: null }).eq('id', row.id)
    }
    return
  }

  if (opts.mode === 'seq') {
    const { available } = await resolveRingGroupAvailableMembers(admin, opts.groupId)
    // Ring the next available member (skipping past failed adds like the entry
    // loop does).
    for (let i = opts.nextIndex; i < available.length; i++) {
      const member = available[i]
      const add = await addConferenceParticipant({
        room: opts.room,
        to: `client:${member.user_id}`,
        from: row?.from_number || voiceCallerId() || '',
        label: 'agent',
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        timeoutSec: member.member_timeout_sec ?? 20,
        statusCallback: groupAgentStatusCb({
          baseUrl: opts.baseUrl,
          callerCallSid: opts.callerCallSid,
          room: opts.room,
          groupId: opts.groupId,
          mode: 'seq',
          nextIndex: i + 1,
        }),
      })
      if (add.ok && add.callSid) {
        if (row) {
          await admin
            .from('calls')
            .update({
              conference_agent_sid: add.callSid,
              handled_by: member.user_id,
              ring_pending: [{ call_sid: add.callSid, user_id: member.user_id }],
            })
            .eq('id', row.id)
        }
        return
      }
    }
    // fell through — exhausted
  } else {
    // Simultaneous: another leg may still be ringing. Check Twilio directly
    // (stateless — immune to ring_pending update races between sibling events).
    for (const p of pending) {
      const s = await fetchCallStatus(p.call_sid)
      if (s === 'queued' || s === 'ringing' || s === 'in-progress') return
    }
  }

  // Group exhausted. Claim the redirect by atomically nulling ring_pending so
  // racing sibling events can't send the caller to voicemail twice (a second
  // redirect would restart the voicemail prompt mid-recording).
  if (row) {
    const { data: claimRows } = await admin
      .from('calls')
      .update({ ring_pending: null })
      .eq('id', row.id)
      .not('ring_pending', 'is', null)
      .select('id')
    if ((claimRows?.length ?? 0) === 0) return
  }
  console.log('[dialer.conference.ring-group] group exhausted → voicemail for', opts.callerCallSid)
  await redirectCall({
    callSid: opts.callerCallSid,
    twimlUrl: `${opts.baseUrl}/api/dialer/voice/twiml/voicemail`,
  }).catch(() => {})
}
