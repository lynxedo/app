// POST /api/hub/radio/transmission/[id]/end — the end marker. Carries the total
// piece count: that is what tells the receiver "he stopped talking" as opposed to
// "the next piece is slow", and flips their screen back to the mic.
import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { loadTransmissionForParticipant, touchSession } from '@/lib/radio/session'
import { radioBroadcast } from '@/lib/radio/broadcast'
import { radioTopic } from '@/lib/radio/types'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { id } = await params

  let body: { pieceCount?: unknown; durationMs?: unknown } = {}
  try { body = await request.json() } catch { /* tolerated — a bare end marker still ends it */ }
  const pieceCount = Number.isInteger(body.pieceCount) && (body.pieceCount as number) >= 0 ? (body.pieceCount as number) : null
  const durationMs = Number.isFinite(body.durationMs) && (body.durationMs as number) >= 0 ? Math.round(body.durationMs as number) : null

  const gate = await loadTransmissionForParticipant(id, auth.userId, auth.companyId)
  if ('error' in gate) return gate.error
  const { admin, session, transmission } = gate
  if (transmission.sender_id !== auth.userId) {
    return NextResponse.json({ error: 'Not your transmission' }, { status: 403 })
  }

  if (!transmission.ended_at) {
    const { error } = await admin
      .from('radio_transmissions')
      .update({ ended_at: new Date().toISOString(), piece_count: pieceCount, duration_ms: durationMs })
      .eq('id', transmission.id)
      .is('ended_at', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await Promise.all([
    touchSession(admin, session.id),
    radioBroadcast(radioTopic(session.id), 'transmission-end', {
      transmissionId: transmission.id, senderId: auth.userId, pieceCount,
    }),
  ])
  return NextResponse.json({ ok: true })
}
