import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveConferenceRoom } from '@/lib/dialer-active-call'

// GET /api/dialer/voice/conference/active
// Returns the calling user's current active conference room (if any). The web
// dialer calls this when it CONNECTS an inbound call — inbound rooms are
// generated server-side, so the web has to look its room up to enable the
// in-call Transfer / Hold controls. Outbound already knows its room locally.
export async function GET() {
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

  const active = await resolveActiveConferenceRoom({
    bodyRoom: undefined,
    userId: user.id,
    companyId: profile.company_id,
  })
  // `answered` + `from` let the native iOS dialer (which lacks the native
  // getActiveCall hook) re-adopt a live, ANSWERED call into its in-call UI after
  // answering on CallKit. `room` alone is kept for the existing inbound-connect caller.
  return NextResponse.json({
    room: active?.room ?? null,
    answered: active?.answered ?? false,
    from: active?.callerNumber ?? null,
  })
}
