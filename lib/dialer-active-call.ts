// Resolve the conference room for a user's active Dialer call. Shared by the
// hold + transfer endpoints. Trusts an explicit room only if it matches a
// non-ended call owned by this user (validates client-supplied rooms); otherwise
// falls back to the user's most recent active conference call (the inbound path,
// where the web didn't generate the room itself).

import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeRoomName } from '@/lib/twilio-conference'

const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

export async function resolveActiveConferenceRoom(opts: {
  bodyRoom: string | undefined
  userId: string
  companyId?: string | null
}): Promise<{ room: string; callId: string; callerNumber: string } | null> {
  const admin = createAdminClient()
  const sanitized = sanitizeRoomName(opts.bodyRoom)
  const companyId = opts.companyId || HEROES_COMPANY_ID

  let query = admin
    .from('calls')
    .select('id, conference_name, from_number, to_number, direction')
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
  }
}
