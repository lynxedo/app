// POST /api/hub/radio/session/[id]/close — either person ends the channel. The other
// is told. Leaving the screen does NOT do this; the channel stays warm for the hour.
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
  const { admin, session, otherId } = gate

  const eff = radioEffectiveStatus(session)
  if (eff !== 'pending' && eff !== 'active') {
    return NextResponse.json({ session: { ...session, status: eff } })  // already over
  }

  const { error } = await admin
    .from('radio_sessions')
    .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: auth.userId })
    .eq('id', session.id)
    .in('status', ['pending', 'active'])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await radioBroadcastAll(
    [radioTopic(session.id), radioUserTopic(otherId), radioUserTopic(auth.userId)],
    'closed',
    { sessionId: session.id, byId: auth.userId },
  )
  return NextResponse.json({ ok: true })
}
