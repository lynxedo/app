// POST /api/hub/radio/session/[id]/accept — the recipient says yes. pending → active.
// The accept step is the gate: nobody's phone can be talked into out of nowhere.
import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { loadSessionForParticipant } from '@/lib/radio/session'
import { radioBroadcastAll } from '@/lib/radio/broadcast'
import { radioEffectiveStatus, radioTopic, radioUserTopic, type RadioSessionRow } from '@/lib/radio/types'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { id } = await params

  const gate = await loadSessionForParticipant(id, auth.userId, auth.companyId)
  if ('error' in gate) return gate.error
  const { admin, session, isInitiator } = gate
  if (isInitiator) return NextResponse.json({ error: 'Only the person invited can accept' }, { status: 403 })

  const eff = radioEffectiveStatus(session)
  if (eff === 'active') return NextResponse.json({ session: { ...session, status: eff } })  // already on — fine
  if (eff !== 'pending') {
    return NextResponse.json({ error: 'That invite has ' + (eff === 'expired' ? 'expired' : 'ended'), status: eff }, { status: 409 })
  }

  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('radio_sessions')
    .update({ status: 'active', accepted_at: now, last_activity_at: now })
    .eq('id', session.id)
    .eq('status', 'pending')            // lose the race gracefully
    .select('*')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const updated = (data as RadioSessionRow | null) ?? { ...session, status: 'active' as const, accepted_at: now, last_activity_at: now }

  await radioBroadcastAll(
    [radioTopic(session.id), radioUserTopic(session.initiator_id)],
    'accepted',
    { sessionId: session.id, byId: auth.userId },
  )
  return NextResponse.json({ session: updated })
}
