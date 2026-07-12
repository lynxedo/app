import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// AI Voice Receptionist — cell transfer: the ACCEPT step.
//
// The recipient's screen (<Gather> in /cell-screen) POSTs the pressed digit
// here. If they pressed 1 we atomically claim the attempt (pending → connected)
// and return TwiML that DOESN'T hang up — so Twilio bridges this recipient's leg
// to the waiting caller. Any other key (or losing the race) hangs up, and the
// caller's <Dial action> (/transfer-cell) moves on to the next recipient.
//
// The atomic conditional UPDATE (.eq('status','pending')) is the race gate, same
// pattern as the Hub-DM /transfer/accept route.

export const runtime = 'nodejs'

function xml(body: string) {
  return new NextResponse(body, { status: 200, headers: { 'Content-Type': 'text/xml' } })
}

const HANGUP = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>'

async function handle(req: NextRequest): Promise<NextResponse> {
  const u = new URL(req.url)
  const attemptId = u.searchParams.get('a') || ''
  const uidRaw = u.searchParams.get('u') || ''
  const uid = /^[0-9a-f-]{36}$/i.test(uidRaw) ? uidRaw : null

  // Digits come from the <Gather> POST body; fall back to the query string.
  let digits = ''
  try {
    const raw = await req.text()
    if (raw) digits = new URLSearchParams(raw).get('Digits') || ''
  } catch {
    /* ignore */
  }
  if (!digits) digits = u.searchParams.get('Digits') || ''

  if (!attemptId || digits !== '1') {
    // Declined (or no key) → hang up this leg; the caller advances to the next.
    return xml(HANGUP)
  }

  try {
    const admin = createAdminClient()
    const { data: claimed } = await admin
      .from('voice_transfer_attempts')
      .update({ status: 'connected', accepted_by: uid })
      .eq('id', attemptId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claimed) {
      // Someone/something else already took (or ended) it.
      return xml(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Sorry, that call was just taken. Goodbye.</Say><Hangup/></Response>',
      )
    }
  } catch {
    return xml(HANGUP)
  }

  // Not hanging up → Twilio bridges this recipient to the waiting caller.
  return xml(
    '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Connecting you now.</Say></Response>',
  )
}

export async function POST(req: NextRequest) {
  return handle(req)
}
export async function GET(req: NextRequest) {
  return handle(req)
}
