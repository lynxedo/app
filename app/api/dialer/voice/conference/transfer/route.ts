import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164, voiceCallerId } from '@/lib/twilio-voice'
import {
  addConferenceParticipant,
  holdParticipant,
  removeParticipant,
  updateParticipant,
} from '@/lib/twilio-conference'
import { resolveActiveConferenceRoom } from '@/lib/dialer-active-call'

const HEROES_COMPANY_ID = process.env.DIALER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// POST /api/dialer/voice/conference/transfer
// Body: { room?, mode, to? }
//
// Drives transfer on the user's active conference call. Four modes:
//   'cold'          — blind transfer: add the target, drop the agent. The
//                     customer + target are connected; the agent is off the call.
//                     (`to` required.)
//   'warm-consult'  — put the customer on hold (music), add the target so the
//                     agent + target can talk privately first. (`to` required.)
//   'warm-complete' — finish a warm transfer: take the customer off hold and drop
//                     the agent, leaving customer + target connected.
//   'warm-cancel'   — abandon a warm transfer: remove the target and take the
//                     customer off hold, returning to the agent + customer call.
//
// Target (`to`) may be a 3-digit extension, a Hub user id (UUID → Client), or a
// PSTN number. Internal targets ring the teammate's Dialer (web/native), so a
// warm transfer between two Hub users works end to end.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_dialer, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_dialer) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: { room?: string; mode?: string; to?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const mode = body.mode
  if (!mode || !['cold', 'warm-consult', 'warm-complete', 'warm-cancel'].includes(mode)) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
  }

  const companyId = profile.company_id || HEROES_COMPANY_ID
  const active = await resolveActiveConferenceRoom({ bodyRoom: body.room, userId: user.id, companyId })
  if (!active) return NextResponse.json({ error: 'No active conference call found' }, { status: 404 })
  const room = active.room

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const holdUrl = `${baseUrl}/api/dialer/voice/twiml/hold-music`
  const callerId = voiceCallerId() || undefined

  // Modes that ADD a target need a resolved dial target.
  let target: string | null = null
  if (mode === 'cold' || mode === 'warm-consult') {
    target = await resolveTarget(body.to, companyId)
    if (!target) return NextResponse.json({ error: 'Invalid or unassigned transfer target' }, { status: 400 })
  }

  try {
    if (mode === 'cold') {
      // Add the target, then drop the agent (after flipping the agent's
      // endConferenceOnExit so leaving doesn't tear down the conference).
      const add = await addConferenceParticipant({
        room,
        to: target!,
        from: callerId || '',
        label: 'transfer',
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        timeoutSec: 30,
      })
      if (!add.ok) return NextResponse.json({ error: add.error }, { status: 502 })
      await updateParticipant({ room, label: 'agent', endConferenceOnExit: false })
      await removeParticipant({ room, label: 'agent' })
      return NextResponse.json({ ok: true, mode })
    }

    if (mode === 'warm-consult') {
      // Hold the customer (music), then bring the target in to consult.
      const held = await holdParticipant({ room, label: 'customer', hold: true, holdUrl })
      if (!held.ok) return NextResponse.json({ error: held.error }, { status: 502 })
      const add = await addConferenceParticipant({
        room,
        to: target!,
        from: callerId || '',
        label: 'transfer',
        startConferenceOnEnter: true,
        endConferenceOnExit: false,
        timeoutSec: 30,
      })
      if (!add.ok) {
        // Roll back the hold so the customer isn't stranded on music.
        await holdParticipant({ room, label: 'customer', hold: false })
        return NextResponse.json({ error: add.error }, { status: 502 })
      }
      return NextResponse.json({ ok: true, mode })
    }

    if (mode === 'warm-complete') {
      // Merge: customer off hold, drop the agent → customer + target remain.
      await holdParticipant({ room, label: 'customer', hold: false })
      await updateParticipant({ room, label: 'agent', endConferenceOnExit: false })
      await removeParticipant({ room, label: 'agent' })
      return NextResponse.json({ ok: true, mode })
    }

    // warm-cancel: remove the target, customer off hold → back to agent + customer.
    await removeParticipant({ room, label: 'transfer' })
    await holdParticipant({ room, label: 'customer', hold: false })
    return NextResponse.json({ ok: true, mode })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'transfer_failed' },
      { status: 502 }
    )
  }
}

// Resolve a transfer target into a Twilio dial string:
//   3-digit extension → look up the owning user → 'client:<userId>'
//   UUID              → 'client:<userId>' (a Hub user identity)
//   phone number      → E.164 PSTN
async function resolveTarget(raw: string | undefined, companyId: string): Promise<string | null> {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null

  // 3-digit extension
  if (/^[1-9][0-9]{2}$/.test(trimmed)) {
    const admin = createAdminClient()
    const { data: owner } = await admin
      .from('user_profiles')
      .select('id')
      .eq('company_id', companyId)
      .eq('dialer_extension', trimmed)
      .maybeSingle()
    return owner?.id ? `client:${owner.id}` : null
  }

  // UUID identity (a Hub user)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return `client:${trimmed}`
  }

  // PSTN
  const e164 = toE164(trimmed)
  return e164 ? e164 : null
}
