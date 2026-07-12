import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatPhone } from '@/lib/format'

// AI Voice Receptionist — cell transfer: the "press 1 to accept" SCREEN.
//
// Runs on the RECIPIENT's leg the instant their cell answers, BEFORE the legs
// are bridged (Twilio's <Number url> call-screening). Pressing 1 accepts the
// call (→ /api/voice/transfer/cell-accept, which bridges); anything else or no
// input hangs up, so the recipient's own voicemail can't silently swallow the
// transfer. The caller (on the other leg) hears ringback while this runs.
//
// Public (no signature gate) like /transfer/hold: it's driven entirely by the
// unguessable attempt id and only ever returns a screen/hangup. The
// security-sensitive step (bridging) happens on an explicit keypress in
// /cell-accept.

export const runtime = 'nodejs'

function xml(body: string) {
  return new NextResponse(body, { status: 200, headers: { 'Content-Type': 'text/xml' } })
}
function esc(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const u = new URL(req.url)
  const attemptId = u.searchParams.get('a') || ''
  const uid = u.searchParams.get('u') || ''
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || u.origin
  if (!attemptId) return xml('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>')

  let callerLabel = 'a caller'
  try {
    const admin = createAdminClient()
    const { data: a } = await admin
      .from('voice_transfer_attempts')
      .select('caller_from, status')
      .eq('id', attemptId)
      .maybeSingle()
    // Already taken (defensive — in sequential mode only one cell rings at a time).
    if (a && (a.status === 'accepted' || a.status === 'connected')) {
      return xml(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">That call was just taken by someone else. Goodbye.</Say><Hangup/></Response>',
      )
    }
    if (a?.caller_from) callerLabel = formatPhone(a.caller_from) || a.caller_from
  } catch {
    // fall through with the generic label
  }

  const acceptUrl = `${baseUrl}/api/voice/transfer/cell-accept?a=${encodeURIComponent(attemptId)}&u=${encodeURIComponent(uid)}`
  const prompt = `You have a call from ${callerLabel} waiting on the line. Press 1 to take the call now, or hang up to pass.`
  const gatherAttrs = [
    'input="dtmf"',
    'numDigits="1"',
    'timeout="12"',
    `action="${esc(acceptUrl)}"`,
    'method="POST"',
  ].join(' ')
  // If they press nothing, the <Gather> falls through to <Hangup/> → the caller's
  // <Dial action> advances to the next recipient.
  return xml(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Gather ${gatherAttrs}><Say voice="alice">${esc(prompt)}</Say></Gather><Hangup/></Response>`,
  )
}

export async function POST(req: NextRequest) {
  return handle(req)
}
export async function GET(req: NextRequest) {
  return handle(req)
}
