// POST /api/hub/radio/session/[id]/here — "I'm using this channel on THIS device now."
//
// A channel belongs to a person, but a person can have the Hub open on a laptop and
// in the phone app at once, and now that Radio plays on every Hub page, both would
// play every word and both would hold a microphone. So exactly one device per person
// runs the audio: whichever one last opened the channel screen, accepted, or tapped
// "Use here" on the bar. This tells that person's other devices to step back. It
// changes nothing in the database — the device id is a random per-browser label, and
// a device that misses the broadcast still steps back the next time it is told.
import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { loadSessionForParticipant } from '@/lib/radio/session'
import { radioBroadcast } from '@/lib/radio/broadcast'
import { radioTopic } from '@/lib/radio/types'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { id } = await params

  let body: { deviceId?: unknown } = {}
  try { body = await request.json() } catch { /* 400 below */ }
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 64) : ''
  if (!deviceId) return NextResponse.json({ error: 'deviceId is required' }, { status: 400 })

  const gate = await loadSessionForParticipant(id, auth.userId, auth.companyId)
  if ('error' in gate) return gate.error

  await radioBroadcast(radioTopic(id), 'device', { userId: auth.userId, deviceId })
  return NextResponse.json({ ok: true })
}
