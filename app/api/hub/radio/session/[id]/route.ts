// GET /api/hub/radio/session/[id] — the channel as it is right now. Called when the
// Radio screen opens, on app resume, and whenever a broadcast might have been missed.
// Returns the effective status (a stale 'active' reads as 'expired'), who's who, the
// expiry hint, and the recent transmissions with their piece ids so the play queue
// can catch up. Audio itself is fetched per piece through /api/hub/radio/piece/[id].
import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { loadSessionForParticipant, radioNames } from '@/lib/radio/session'
import { radioEffectiveStatus, radioExpiresAt, type RadioPieceRow, type RadioTransmissionRow } from '@/lib/radio/types'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { id } = await params

  const gate = await loadSessionForParticipant(id, auth.userId, auth.companyId)
  if ('error' in gate) return gate.error
  const { admin, session, isInitiator, otherId } = gate

  const [names, { data: txRows }] = await Promise.all([
    radioNames(admin, [auth.userId, otherId]),
    admin
      .from('radio_transmissions')
      .select('id, session_id, sender_id, started_at, ended_at, piece_count, duration_ms')
      .eq('session_id', session.id)
      .order('started_at', { ascending: false })
      .limit(20),
  ])
  const transmissions = ((txRows ?? []) as RadioTransmissionRow[]).reverse()

  let pieces: Pick<RadioPieceRow, 'id' | 'transmission_id' | 'seq' | 'mime' | 'duration_ms' | 'bytes'>[] = []
  if (transmissions.length) {
    const { data: pieceRows } = await admin
      .from('radio_pieces')
      .select('id, transmission_id, seq, mime, duration_ms, bytes')
      .in('transmission_id', transmissions.map(t => t.id))
      .order('seq', { ascending: true })
    pieces = (pieceRows ?? []) as typeof pieces
  }

  const status = radioEffectiveStatus(session)
  return NextResponse.json({
    session: { ...session, status },
    expiresAt: status === 'active' ? radioExpiresAt(session) : null,
    me: { id: auth.userId, name: names[auth.userId] ?? 'You', isInitiator },
    other: { id: otherId, name: names[otherId] ?? 'Teammate' },
    transmissions: transmissions.map(t => ({
      ...t,
      pieces: pieces
        .filter(p => p.transmission_id === t.id)
        .map(p => ({ id: p.id, seq: p.seq, mime: p.mime, duration_ms: p.duration_ms, bytes: p.bytes })),
    })),
  })
}
