import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirectCall } from '@/lib/twilio-conference'

// AI Voice Receptionist — Hub-DM transfer: a teammate taps "Take the call".
//
// Authenticated (a logged-in Hub user in the caller's company). First tap wins
// via an atomic conditional update; the caller's HOLD loop then sees 'accepted'
// and bridges them to this user's Dialer softphone. We also redirect the
// caller's call straight back to /hold so the connect is instant, not on the
// next hold-loop tick.

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { attemptId?: string }
  const attemptId = String(body.attemptId || '')
  if (!attemptId) return NextResponse.json({ ok: false, error: 'missing_attempt' }, { status: 400 })

  const admin = createAdminClient()
  const { data: a } = await admin
    .from('voice_transfer_attempts')
    .select('id, company_id, caller_call_sid, status')
    .eq('id', attemptId)
    .maybeSingle()
  if (!a) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  // The accepter must belong to the caller's company.
  const { data: prof } = await admin
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .maybeSingle()
  if (!prof || prof.company_id !== a.company_id) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  if (a.status !== 'pending') {
    return NextResponse.json({ ok: false, taken: true })
  }

  // Atomic first-tap-wins claim.
  const { data: claimed } = await admin
    .from('voice_transfer_attempts')
    .update({ status: 'accepted', accepted_by: user.id })
    .eq('id', attemptId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (!claimed) return NextResponse.json({ ok: false, taken: true })

  // Instantly move the caller to the connect step (their /hold sees 'accepted'
  // and dials this user's softphone). Best-effort — if the redirect fails, the
  // caller's own hold loop will pick up the 'accepted' state on its next tick.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  if (a.caller_call_sid) {
    await redirectCall({
      callSid: a.caller_call_sid,
      twimlUrl: `${baseUrl}/api/voice/transfer/hold?a=${attemptId}&n=0`,
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
