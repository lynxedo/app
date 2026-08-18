// Resolve the conference room for a user's active Dialer call. Shared by the
// hold + transfer endpoints. Trusts an explicit room only if it matches a
// non-ended call owned by this user (validates client-supplied rooms); otherwise
// falls back to the user's most recent active conference call (the inbound path,
// where the web didn't generate the room itself).

import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeRoomName } from '@/lib/twilio-conference'

const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

export type ActiveConference = {
  room: string
  callId: string
  callerNumber: string
  conferenceSid: string | null
  agentSid: string | null
  customerSid: string | null
  transferSid: string | null
  // True once a participant has actually joined (answered) — lets callers tell a
  // live conversation from a call that's still ringing through a group.
  answered: boolean
}

export async function resolveActiveConferenceRoom(opts: {
  bodyRoom: string | undefined
  userId: string
  companyId?: string | null
}): Promise<ActiveConference | null> {
  const admin = createAdminClient()
  const sanitized = sanitizeRoomName(opts.bodyRoom)
  const companyId = opts.companyId || HEROES_COMPANY_ID

  let query = admin
    .from('calls')
    .select('id, conference_name, from_number, to_number, direction, conference_sid, conference_agent_sid, conference_customer_sid, conference_transfer_sid, answered_at')
    .eq('company_id', companyId)
    .is('ended_at', null)
    .not('conference_name', 'is', null)
    .or(`handled_by.eq.${opts.userId},initiated_by.eq.${opts.userId}`)
    .order('created_at', { ascending: false })
    .limit(1)

  if (sanitized) query = query.eq('conference_name', sanitized)

  const { data } = await query.maybeSingle()
  if (!data?.conference_name) return null

  // The customer's number = the far end. Outbound: to_number; inbound: from_number.
  const callerNumber = data.direction === 'inbound' ? (data.from_number as string) : (data.to_number as string)
  return {
    room: data.conference_name as string,
    callId: data.id as string,
    callerNumber: callerNumber || '',
    conferenceSid: (data.conference_sid as string) || null,
    agentSid: (data.conference_agent_sid as string) || null,
    customerSid: (data.conference_customer_sid as string) || null,
    transferSid: (data.conference_transfer_sid as string) || null,
    answered: !!data.answered_at,
  }
}

// Resolve the calls row for an in-call note / after-call disposition. Unlike
// resolveActiveConferenceRoom this does NOT require the call to still be live —
// disposition fires right after hang-up, when ended_at is set and the conference
// is gone. Returns just the calls.id (null if none).
//
// ⚠ Aug 18 2026 — this used to AND an ownership filter (handled_by = me OR
// initiated_by = me) onto the room match, and that silently discarded notes:
//
//   • `initiated_by` is NULL on every inbound call (all 1,013 in the last 60
//     days), so an inbound call can only ever match through `handled_by`.
//   • The 832 inbound webhook stamps `handled_by` with
//     dialer_settings.inbound_route_user_id BEFORE the call is offered to
//     anyone — at Heroes that is Kathryn. So on an inbound call, only Kathryn
//     resolved. Anyone else typing a note got callId null, and the note was
//     dropped while the route still answered 200.
//
// The conference room already identifies the call exactly, so when one is
// supplied ownership is not asked for — an inbound call is not "owned" by
// whoever happens to answer it. Company scope is the real boundary, and it
// matches what the Call Log already shows any dialer user for their company.
//
// ⚠ And the room is often ABSENT on exactly the calls that were broken. Inbound
// rooms are generated server-side, and the web dialer learns its room from
// /api/dialer/voice/conference/active — which resolves through
// resolveActiveConferenceRoom and carries the SAME ownership filter. So on an
// inbound call a non-route user got no room either, and a room-only fix would
// never have fired for them. The inbound `<Client>` dial passes no room
// parameter, and no column records who actually answered, so the server cannot
// re-derive it.
//
// Hence `farEndNumber`: the notepad already knows the number it is showing, and
// "the live/recent call with THIS customer" pins the call without asking who
// owns it. Matched on the last 10 digits (the phone_digits convention) against
// whichever end is the customer — from_number inbound, to_number outbound.
//
// With neither a room nor a number we still fall back to "my most recent call",
// because attaching to the company's most recent call could file this user's
// note against a call a colleague just took. That fallback now also counts
// `transferred_to_user_id`, which is the one field written on a CONFIRMED human
// takeover — so a rep who picks up Amber's transfer can note it.
export async function resolveRecentCallId(opts: {
  bodyRoom?: string | undefined
  /** Far-end (customer) number of the call being noted — used when no room is available. */
  farEndNumber?: string | null
  userId: string
  companyId?: string | null
}): Promise<string | null> {
  const admin = createAdminClient()
  const sanitized = sanitizeRoomName(opts.bodyRoom)
  const companyId = opts.companyId || HEROES_COMPANY_ID
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()

  let query = admin
    .from('calls')
    .select('id')
    .eq('company_id', companyId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)

  // Digits only — this is interpolated into a PostgREST filter, so it must not
  // be able to carry filter grammar.
  const farEndDigits = (opts.farEndNumber || '').replace(/\D/g, '').slice(-10)

  if (sanitized) {
    // The room pins the exact call — no ownership test (see note above).
    query = query.eq('conference_name', sanitized)
  } else if (farEndDigits.length === 10) {
    // The call with this customer. Inbound puts them in from_number, outbound in
    // to_number, so either end may match.
    query = query.or(`from_number.ilike.%${farEndDigits},to_number.ilike.%${farEndDigits}`)
  } else {
    query = query.or(
      `handled_by.eq.${opts.userId},initiated_by.eq.${opts.userId},transferred_to_user_id.eq.${opts.userId}`
    )
  }

  const { data } = await query.maybeSingle()
  return (data?.id as string) || null
}
