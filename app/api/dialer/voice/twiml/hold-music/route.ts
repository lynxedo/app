import { NextRequest, NextResponse } from 'next/server'
import { DEFAULT_HOLD_MUSIC_URL, twimlHoldMusic } from '@/lib/twilio-conference'

// Looping hold music. Served as both the inbound caller's <Conference waitUrl>
// (while waiting for an agent to join) and the HoldUrl when a participant is put
// on hold during a warm transfer. Twilio fetches this and plays the resulting
// TwiML to the held / waiting participant.
//
// Public (no signature gate): waitUrl/HoldUrl are fetched by Twilio without our
// signature header, and the response is just music — no data, no side effects.
// An optional ?url= override lets a company point at its own clip later.
function render(req: NextRequest) {
  const override = new URL(req.url).searchParams.get('url')
  const musicUrl = override && /^https?:\/\//.test(override) ? override : DEFAULT_HOLD_MUSIC_URL
  return new NextResponse(twimlHoldMusic(musicUrl), {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

// Twilio fetches waitUrl/HoldUrl via GET by default and POST for some flows.
export async function GET(req: NextRequest) {
  return render(req)
}
export async function POST(req: NextRequest) {
  return render(req)
}
