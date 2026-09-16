// POST /api/hub/radio/session — open a channel with the other person in a 1-on-1 DM.
// Creates a 'pending' session, tells the recipient (realtime + push), returns the row.
// Idempotent: if a live channel or a fresh invite already exists for this DM, that
// one comes back instead of a duplicate — two taps on the button is one channel.
import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendHubPush } from '@/lib/hub-push'
import { radioBroadcast } from '@/lib/radio/broadcast'
import { radioNames } from '@/lib/radio/session'
import { radioEffectiveStatus, radioUserTopic, type RadioSessionRow } from '@/lib/radio/types'

export async function POST(request: Request) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error

  let body: { conversationId?: unknown } = {}
  try { body = await request.json() } catch { /* fall through to the 400 */ }
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
  if (!conversationId) return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })

  const admin = createAdminClient()
  const [{ data: conv }, { data: members }, { data: me }] = await Promise.all([
    admin.from('conversations').select('id, company_id').eq('id', conversationId).maybeSingle(),
    admin.from('conversation_members').select('user_id').eq('conversation_id', conversationId).is('archived_at', null),
    admin.from('user_profiles').select('can_access_radio').eq('id', auth.userId).maybeSingle(),
  ])
  if (!conv || (conv as { company_id: string }).company_id !== auth.companyId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!(me as { can_access_radio?: boolean } | null)?.can_access_radio) {
    return NextResponse.json({ error: 'Radio is not enabled for you' }, { status: 403 })
  }

  // Radio is 1-on-1. Exactly two active members, and the caller is one of them.
  const ids = ((members ?? []) as { user_id: string }[]).map(m => m.user_id)
  if (ids.length !== 2 || !ids.includes(auth.userId)) {
    return NextResponse.json({ error: 'Radio is for 1-on-1 conversations' }, { status: 400 })
  }
  const recipientId = ids.find(id => id !== auth.userId)!
  const { data: them } = await admin.from('user_profiles').select('can_access_radio').eq('id', recipientId).maybeSingle()
  if (!(them as { can_access_radio?: boolean } | null)?.can_access_radio) {
    return NextResponse.json({ error: 'Radio is not enabled for them' }, { status: 403 })
  }

  // Reuse a channel that's still open, or an invite that's still fresh.
  const { data: existingRow } = await admin
    .from('radio_sessions')
    .select('*')
    .eq('conversation_id', conversationId)
    .in('status', ['pending', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const existing = existingRow as RadioSessionRow | null
  if (existing) {
    const eff = radioEffectiveStatus(existing)
    if (eff === 'active' || eff === 'pending') {
      return NextResponse.json({ session: { ...existing, status: eff }, reused: true })
    }
    // Stale 'active' or unanswered 'pending' — record what actually happened before starting fresh.
    await admin.from('radio_sessions').update({ status: 'expired' }).eq('id', existing.id)
  }

  const { data: created, error } = await admin
    .from('radio_sessions')
    .insert({
      company_id: auth.companyId,
      conversation_id: conversationId,
      initiator_id: auth.userId,
      recipient_id: recipientId,
      status: 'pending',
    })
    .select('*')
    .single()
  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? 'Could not open a channel' }, { status: 500 })
  }
  const session = created as RadioSessionRow

  const names = await radioNames(admin, [auth.userId])
  const fromName = names[auth.userId] ?? 'A teammate'
  await Promise.all([
    radioBroadcast(radioUserTopic(recipientId), 'invite', {
      sessionId: session.id, conversationId, fromId: auth.userId, fromName,
    }),
    // One push for the invite; nothing per transmission. Falls under Hub DND (channelForType default).
    sendHubPush([recipientId], {
      title: `${fromName} wants to open a radio channel`,
      body: 'Tap to accept — press and hold to talk.',
      url: `/hub/radio/${session.id}`,
      type: 'radio_invite',
      groupKey: `radio:${session.id}`,
    }),
  ])

  return NextResponse.json({ session }, { status: 201 })
}
