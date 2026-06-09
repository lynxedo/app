import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { holdParticipant } from '@/lib/twilio-conference'
import { resolveActiveConferenceRoom } from '@/lib/dialer-active-call'

// POST /api/dialer/voice/conference/hold
// Body: { room?: string, hold: boolean }
//
// Puts the CUSTOMER participant of the user's active conference call on hold
// (playing looping hold music) or resumes them. This is the real, server-side
// hold — works on web, desktop, AND native (unlike the Phase-2 native-only
// client-side hold, which just suspended both legs in silence).
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_dialer, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_dialer) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: { room?: string; hold?: boolean }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const hold = body.hold === true

  const active = await resolveActiveConferenceRoom({
    bodyRoom: body.room,
    userId: user.id,
    companyId: profile.company_id,
  })
  if (!active) return NextResponse.json({ error: 'No active conference call found' }, { status: 404 })
  if (!active.conferenceSid || !active.customerSid) {
    return NextResponse.json({ error: 'Conference not fully connected yet' }, { status: 409 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const holdUrl = `${baseUrl}/api/dialer/voice/twiml/hold-music`

  const res = await holdParticipant({
    conferenceSid: active.conferenceSid,
    callSid: active.customerSid,
    hold,
    holdUrl,
  })
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 502 })
  }
  return NextResponse.json({ ok: true, held: hold })
}
