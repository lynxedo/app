// Loading a Radio session on behalf of the caller, and the one rule every route
// shares: you must be one of the two people in it. Writes run as service_role
// (RLS bypassed), so this check IS the authorisation — not a formality.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { RadioSessionRow, RadioTransmissionRow } from './types'

type Admin = ReturnType<typeof createAdminClient>

export type SessionGate =
  | { admin: Admin; session: RadioSessionRow; isInitiator: boolean; otherId: string }
  | { error: NextResponse }

/**
 * Loads the session and proves the caller belongs to it. A wrong company, a
 * non-participant and a missing row all answer 404 — a session id is not
 * something a stranger should be able to confirm exists.
 */
export async function loadSessionForParticipant(sessionId: string, userId: string, companyId: string): Promise<SessionGate> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('radio_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle()
  if (error) return { error: NextResponse.json({ error: error.message }, { status: 500 }) }
  const session = data as RadioSessionRow | null
  if (!session || session.company_id !== companyId) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  const isInitiator = session.initiator_id === userId
  const isRecipient = session.recipient_id === userId
  if (!isInitiator && !isRecipient) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  return { admin, session, isInitiator, otherId: isInitiator ? session.recipient_id : session.initiator_id }
}

/** Same gate, entered from a transmission id. */
export async function loadTransmissionForParticipant(transmissionId: string, userId: string, companyId: string): Promise<
  | ({ transmission: RadioTransmissionRow } & Exclude<SessionGate, { error: NextResponse }>)
  | { error: NextResponse }
> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('radio_transmissions')
    .select('*')
    .eq('id', transmissionId)
    .maybeSingle()
  if (error) return { error: NextResponse.json({ error: error.message }, { status: 500 }) }
  const transmission = data as RadioTransmissionRow | null
  if (!transmission) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  const gate = await loadSessionForParticipant(transmission.session_id, userId, companyId)
  if ('error' in gate) return gate
  return { transmission, ...gate }
}

/** Every transmission keeps the channel alive another hour. */
export async function touchSession(admin: Admin, sessionId: string): Promise<void> {
  await admin.from('radio_sessions').update({ last_activity_at: new Date().toISOString() }).eq('id', sessionId)
}

/** Display names for the two people, for pushes and the screen header. */
export async function radioNames(admin: Admin, ids: string[]): Promise<Record<string, string>> {
  const { data } = await admin.from('hub_users').select('id, display_name').in('id', ids)
  const out: Record<string, string> = {}
  for (const row of (data ?? []) as { id: string; display_name: string | null }[]) {
    out[row.id] = row.display_name || 'Teammate'
  }
  return out
}
