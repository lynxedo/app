// POST /api/hub/radio/session/[id]/decline — "Not now." Tells the opener plainly;
// there is no ringing and no retry loop.
import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { loadSessionForParticipant } from '@/lib/radio/session'
import { radioBroadcastAll } from '@/lib/radio/broadcast'
import { radioEffectiveStatus, radioTopic, radioUserTopic } from '@/lib/radio/types'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { id } = await params

  const gate = await loadSessionForParticipant(id, auth.userId, auth.companyId)
  if ('error' in gate) return gate.error
  const { admin, session, isInitiator } = gate
  if (isInitiator) return NextResponse.json({ error: 'Only the person invited can decline' }, { status: 403 })

  const eff = radioEffectiveStatus(session)
  if (eff !== 'pending') return NextResponse.json({ session: { ...session, status: eff } })  // nothing to decline

  const { error } = await admin
    .from('radio_sessions')
    .update({ status: 'declined', closed_at: new Date().toISOString(), closed_by: auth.userId })
    .eq('id', session.id)
    .eq('status', 'pending')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await radioBroadcastAll(
    [radioTopic(session.id), radioUserTopic(session.initiator_id)],
    'declined',
    { sessionId: session.id, byId: auth.userId },
  )
  return NextResponse.json({ ok: true })
}
