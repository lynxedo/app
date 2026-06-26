import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { EMPTY_VOICE_TWIML, validateTwilioVoiceSignature, voiceConfigured } from '@/lib/twilio-voice'
import { cancelCall, updateParticipant } from '@/lib/twilio-conference'
import type { RingPendingEntry } from '@/lib/dialer-conference-connect'

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
  if (voiceConfigured()) {
    if (!validateTwilioVoiceSignature(url, paramObj, signature)) {
      return xml(EMPTY_VOICE_TWIML, 403)
    }
  }

  const event = params.get('StatusCallbackEvent') || ''
  const room = params.get('FriendlyName') || ''
  const eventCallSid = params.get('CallSid') || ''
  const eventConferenceSid = params.get('ConferenceSid') || ''
  if (!room) return xml(EMPTY_VOICE_TWIML)

  const admin = createAdminClient()
  try {
    if (event === 'conference-start' || event === 'participant-join') {
      // The call is "answered" when the OTHER party joins. The calls row's own
      // twilio_call_sid leg (outbound: the agent; inbound: the caller) joins at
      // ring time — stamping on that join would mark every outbound call
      // answered the instant it started ringing. So only stamp when the joining
      // leg differs from the row's own.
      let q = admin
        .from('calls')
        .update({ status: 'in-progress', answered_at: new Date().toISOString() })
        .eq('company_id', HEROES_COMPANY_ID)
        .eq('conference_name', room)
        .is('answered_at', null)
      if (eventCallSid) q = q.neq('twilio_call_sid', eventCallSid)
      await q

      // Ring-group attribution: while a group call rings, ring_pending holds
      // [{ call_sid, user_id }] for every leg being dialed. The joining leg
      // identifies who actually answered — stamp them as handled_by (this is
      // what lets THEIR hold/transfer/pause resolve the call) and cancel any
      // sibling legs still ringing (simultaneous mode). The atomic null-out of
      // ring_pending doubles as the claim that stops the agent-status chain
      // from voicemailing an already-answered call.
      if (eventCallSid) {
        const { data: row } = await admin
          .from('calls')
          .select('id, ring_pending, conference_sid')
          .eq('company_id', HEROES_COMPANY_ID)
          .eq('conference_name', room)
          .not('ring_pending', 'is', null)
          .maybeSingle()
        const pending = ((row?.ring_pending as RingPendingEntry[] | null) ?? [])
        const joined = pending.find(p => p.call_sid === eventCallSid)
        if (row && joined) {
          const { data: claimRows } = await admin
            .from('calls')
            .update({
              ring_pending: null,
              handled_by: joined.user_id,
              conference_agent_sid: joined.call_sid,
            })
            .eq('id', row.id)
            .not('ring_pending', 'is', null)
            .select('id')
          if ((claimRows?.length ?? 0) > 0) {
            // The member who ANSWERED was added with endConferenceOnExit=false (so
            // a member who didn't answer couldn't collapse the conference and drop
            // the caller mid-ring). Now that they've joined, flip THEIR leg to
            // endConferenceOnExit=true so the call ends cleanly when they hang up.
            // (The /conference/agent-status route is a second, independent backstop
            // that ends the caller's leg if this update ever fails.)
            const confSid = eventConferenceSid || (row.conference_sid as string | null) || ''
            if (confSid) {
              // Retry once on failure; /conference/agent-status is a second,
              // independent backstop that ends a stranded caller if both miss.
              const flip = await updateParticipant({
                conferenceSid: confSid,
                callSid: eventCallSid,
                endConferenceOnExit: true,
              }).catch(() => ({ ok: false as const, error: 'threw' }))
              if (!flip.ok) {
                await updateParticipant({
                  conferenceSid: confSid,
                  callSid: eventCallSid,
                  endConferenceOnExit: true,
                }).catch(() => {})
              }
            }
            for (const p of pending) {
              if (p.call_sid === eventCallSid) continue
              try { await cancelCall(p.call_sid) } catch { /* best-effort */ }
            }
          }
        }
      }
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
