// POST /api/hub/radio/transmission — "I'm pressing the button." Creates the
// transmission and broadcasts talking-start BEFORE any audio exists, so the other
// person's button locks on the press, not on the first piece. This is also where
// one-at-a-time is enforced: if the other person is mid-hold, you get a 409 with
// who's talking, and your recording is discarded client-side rather than queued.
import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { loadSessionForParticipant, touchSession } from '@/lib/radio/session'
import { radioBroadcast } from '@/lib/radio/broadcast'
import { RADIO_HOLD_CAP_MS, radioEffectiveStatus, radioTopic, type RadioTransmissionRow } from '@/lib/radio/types'

export async function POST(request: Request) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error

  let body: { sessionId?: unknown } = {}
  try { body = await request.json() } catch { /* 400 below */ }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })

  const gate = await loadSessionForParticipant(sessionId, auth.userId, auth.companyId)
  if ('error' in gate) return gate.error
  const { admin, session } = gate

  const eff = radioEffectiveStatus(session)
  if (eff !== 'active') {
    return NextResponse.json({ error: 'The channel is not open', status: eff }, { status: 409 })
  }

  // The talking lock. An open transmission is one with no end marker that started
  // within the hold cap (plus slack) — anything older is a crash, not a speaker.
  const since = new Date(Date.now() - RADIO_HOLD_CAP_MS - 5000).toISOString()
  const { data: openRow } = await admin
    .from('radio_transmissions')
    .select('id, sender_id, started_at')
    .eq('session_id', session.id)
    .is('ended_at', null)
    .gte('started_at', since)
    .order('started_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const open = openRow as Pick<RadioTransmissionRow, 'id' | 'sender_id' | 'started_at'> | null
  if (open && open.sender_id !== auth.userId) {
    return NextResponse.json(
      { error: 'The other person is talking', talking: open.sender_id, startedAt: open.started_at },
      { status: 409 },
    )
  }
  if (open) {
    // Our own previous hold never got its end marker (network, crash). Close it out
    // so the receiver's screen isn't stuck on "talking" forever.
    await admin.from('radio_transmissions').update({ ended_at: new Date().toISOString() }).eq('id', open.id)
  }

  const { data: created, error } = await admin
    .from('radio_transmissions')
    .insert({ session_id: session.id, sender_id: auth.userId })
    .select('id, started_at')
    .single()
  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? 'Could not start' }, { status: 500 })
  }
  const tx = created as { id: string; started_at: string }

  await Promise.all([
    touchSession(admin, session.id),
    radioBroadcast(radioTopic(session.id), 'talking-start', {
      transmissionId: tx.id, senderId: auth.userId, startedAt: tx.started_at,
    }),
  ])
  return NextResponse.json({ transmissionId: tx.id, startedAt: tx.started_at }, { status: 201 })
}
