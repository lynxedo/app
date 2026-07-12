import { NextRequest, NextResponse } from 'next/server'
import { twimlRecordVoicemail } from '@/lib/twilio-voice'
import { DEFAULT_HOLD_MUSIC_URL } from '@/lib/twilio-conference'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCompanyVoicemailGreeting } from '@/lib/voice-receptionist-settings'

// AI Voice Receptionist — Hub-DM transfer: the caller's HOLD loop.
//
// While a caller waits for someone to accept a transfer (Hub DM/push method),
// their call runs this loop: play hold music, then <Redirect> back here to
// re-check the attempt. Three outcomes:
//   • accepted  → bridge the caller to the accepter's Dialer softphone (<Client>)
//   • timed out → record a voicemail with the company's normal greeting
//   • waiting   → play hold music + loop
// Accepting is made INSTANT by /transfer/accept redirecting the caller's call
// straight back here (so it sees 'accepted' immediately); this loop's own
// cadence only governs the timeout backstop.
//
// Public (no signature gate) like the hold-music route: it's driven entirely by
// the attempt id (an unguessable uuid) and returns only hold/dial/voicemail
// TwiML. The security-sensitive step (accepting) is the authenticated endpoint.

export const runtime = 'nodejs'

const HEROES_COMPANY_ID =
  process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'
const MAX_LOOPS = 10 // hard backstop in case expiry math ever misses

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
  const n = parseInt(u.searchParams.get('n') || '0', 10) || 0
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || u.origin
  if (!attemptId) return xml('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>')

  const admin = createAdminClient()
  const { data: a } = await admin
    .from('voice_transfer_attempts')
    .select('id, status, accepted_by, expires_at')
    .eq('id', attemptId)
    .maybeSingle()
  if (!a) return xml('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>')

  // Accepted → connect the caller to the accepter's Dialer softphone. If the
  // softphone doesn't answer in time, transfer-result records a voicemail.
  if (a.status === 'accepted' && a.accepted_by) {
    await admin.from('voice_transfer_attempts').update({ status: 'connected' }).eq('id', attemptId)
    return xml(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Dial action="${esc(
        `${baseUrl}/api/voice/twiml/transfer-result`,
      )}" method="POST" timeout="25"><Client>${esc(a.accepted_by)}</Client></Dial></Response>`,
    )
  }
  if (a.status === 'connected') {
    return xml('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>')
  }

  // Timed out / backstop → mark it + voicemail with the company's normal greeting.
  const expired = Date.now() > new Date(a.expires_at).getTime()
  if (a.status === 'timed_out' || expired || n >= MAX_LOOPS) {
    if (a.status !== 'timed_out') {
      await admin.from('voice_transfer_attempts').update({ status: 'timed_out' }).eq('id', attemptId)
    }
    const g = await getCompanyVoicemailGreeting(admin, HEROES_COMPANY_ID)
    return xml(
      twimlRecordVoicemail({
        action: `${baseUrl}/api/dialer/voice/voicemail/complete`,
        greetingUrl: g.url,
        greetingTts: g.tts,
        spokenFallback:
          "I'm sorry, no one was able to pick up right now. Please leave a message after the tone and a team member will get right back to you. Press pound when finished.",
      }),
    )
  }

  // Still waiting → hold music, then loop back to re-check.
  const next = `${baseUrl}/api/voice/transfer/hold?a=${attemptId}&n=${n + 1}`
  return xml(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Play>${esc(DEFAULT_HOLD_MUSIC_URL)}</Play><Redirect method="POST">${esc(next)}</Redirect></Response>`,
  )
}

export async function POST(req: NextRequest) {
  return handle(req)
}
export async function GET(req: NextRequest) {
  return handle(req)
}
