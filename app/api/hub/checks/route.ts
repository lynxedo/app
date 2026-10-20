import { NextResponse, after } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { broadcastMessageInserted } from '@/lib/hub-message-broadcast'
import { sendHubPush } from '@/lib/hub-push'
import { bridgeHubMessageToChatSynx } from '@/lib/chat-synx'
import {
  getChecksRoomId, canManageChecks, formatCents, RETAKE_PROBLEMS,
  type CheckPhotoReview, type RetakeProblem,
} from '@/lib/check-deposit'

// /api/hub/checks
//
//   GET  ?status=pending|deposited|all  → the checks list
//        Checks-room members + admins see every check; anyone else sees only
//        the ones they sent.
//   POST { contact_id?, customer_name, amount_cents, check_number?, memo?,
//          front: { path, size, width, height, review }, back: { … }, sent_anyway }
//        → saves the check and posts an alert (no photos — they live on the
//          Checks page) in the checks room, mirrored to Slack when bridged.
//
// Open to everyone in Hub (Ben, Oct 15 2026).

type Side = { path?: unknown; size?: unknown; width?: unknown; height?: unknown; review?: unknown }

export async function GET(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_hub' })
  if ('error' in auth) return auth.error
  const admin = createAdminClient()

  const status = new URL(request.url).searchParams.get('status') || 'pending'
  const manager = await canManageChecks(admin, auth.companyId, auth.userId, auth.role)

  let q = admin
    .from('check_deposits')
    .select('id, contact_id, customer_name, amount_cents, check_number, memo, front_review, back_review, sent_anyway, submitted_by, status, deposited_at, deposited_by, posted_at, posted_by, created_at')
    .eq('company_id', auth.companyId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (status === 'pending' || status === 'deposited' || status === 'void') q = q.eq('status', status)
  if (!manager) q = q.eq('submitted_by', auth.userId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = data ?? []

  const userIds = [...new Set(rows.flatMap(r => [r.submitted_by, r.deposited_by, r.posted_by]).filter(Boolean))] as string[]
  const names: Record<string, string> = {}
  if (userIds.length) {
    const { data: users } = await admin.from('hub_users').select('id, display_name').in('id', userIds)
    for (const u of users ?? []) names[u.id] = u.display_name
  }

  return NextResponse.json({
    canManage: manager,
    checks: rows.map(r => ({
      ...r,
      submitted_by_name: names[r.submitted_by] ?? null,
      deposited_by_name: r.deposited_by ? names[r.deposited_by] ?? null : null,
      posted_by_name: r.posted_by ? names[r.posted_by] ?? null : null,
    })),
  })
}

export async function POST(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_hub' })
  if ('error' in auth) return auth.error
  const admin = createAdminClient()

  const body = await request.json().catch(() => null) as {
    contact_id?: unknown; customer_name?: unknown; amount_cents?: unknown
    check_number?: unknown; memo?: unknown; front?: Side; back?: Side; sent_anyway?: unknown
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const customerName = typeof body.customer_name === 'string' ? body.customer_name.trim().slice(0, 200) : ''
  const amountCents = typeof body.amount_cents === 'number' && Number.isInteger(body.amount_cents) ? body.amount_cents : 0
  const checkNumber = typeof body.check_number === 'string' ? body.check_number.trim().slice(0, 30) || null : null
  const memo = typeof body.memo === 'string' ? body.memo.trim().slice(0, 500) || null : null
  if (!customerName) return NextResponse.json({ error: 'Add the customer’s name.' }, { status: 400 })
  if (amountCents <= 0 || amountCents > 100_000_000) return NextResponse.json({ error: 'Add the check amount.' }, { status: 400 })

  // A photo path must be one this company's upload produced — never a key into
  // another tenant's folder.
  const prefix = `hub/${auth.companyId}/`
  const pathOf = (s?: Side) => (typeof s?.path === 'string' && s.path.startsWith(prefix) && !s.path.includes('..') ? s.path : null)
  const frontPath = pathOf(body.front)
  const backPath = pathOf(body.back)
  if (!frontPath || !backPath) return NextResponse.json({ error: 'Take a photo of the front and the back.' }, { status: 400 })

  // Only a known contact in this company can be linked.
  let contactId: string | null = null
  if (typeof body.contact_id === 'string' && body.contact_id) {
    const { data: c } = await admin
      .from('txt_contacts').select('id')
      .eq('id', body.contact_id).eq('company_id', auth.companyId).is('deleted_at', null)
      .maybeSingle()
    contactId = c?.id ?? null
  }

  const reviewOf = (s?: Side) => (s?.review && typeof s.review === 'object' ? s.review as CheckPhotoReview : null)
  const frontReview = reviewOf(body.front)
  const backReview = reviewOf(body.back)

  const { data: row, error: insErr } = await admin
    .from('check_deposits')
    .insert({
      company_id: auth.companyId,
      contact_id: contactId,
      customer_name: customerName,
      amount_cents: amountCents,
      check_number: checkNumber,
      memo,
      front_path: frontPath,
      back_path: backPath,
      front_review: frontReview,
      back_review: backReview,
      sent_anyway: body.sent_anyway === true,
      submitted_by: auth.userId,
    })
    .select('id')
    .single<{ id: string }>()
  if (insErr || !row) {
    console.error('[checks] insert failed', insErr)
    return NextResponse.json({ error: 'Could not save the check — try again.' }, { status: 500 })
  }

  // ── Post it in the checks room ──────────────────────────────────────────
  const roomId = await getChecksRoomId(admin, auth.companyId)
  if (!roomId) return NextResponse.json({ id: row.id, posted: false })

  const { data: me } = await admin.from('hub_users').select('display_name, avatar_url').eq('id', auth.userId).maybeSingle()
  const senderName = me?.display_name?.trim() || 'A teammate'

  const problemText = (r: CheckPhotoReview | null) =>
    (r?.problems ?? []).map(p => RETAKE_PROBLEMS[p as RetakeProblem]).filter(Boolean)
  const flagged = [...problemText(frontReview).map(t => `front: ${t}`), ...problemText(backReview).map(t => `back: ${t}`)]

  const lines = [
    `💵 *Check — ${formatCents(amountCents)}*`,
    `Customer: ${customerName}`,
    checkNumber ? `Check #${checkNumber}` : null,
    memo ? `Note: ${memo}` : null,
    `From: ${senderName}`,
    ...(body.sent_anyway === true && flagged.length ? ['', '⚠️ Sent anyway — the photo check flagged:', ...flagged.map(f => `• ${f}`)] : []),
    '',
    'Mark it deposited in Hub → Checks.',
  ].filter((l): l is string => l !== null)

  const { data: msg, error: msgErr } = await admin
    .from('messages')
    .insert({
      company_id: auth.companyId,
      room_id: roomId,
      sender_id: auth.userId,
      content: lines.join('\n'),
    })
    .select('id')
    .single<{ id: string }>()
  if (msgErr || !msg) {
    console.error('[checks] room post failed', msgErr)
    return NextResponse.json({ id: row.id, posted: false })
  }


  await admin.from('check_deposits').update({ message_id: msg.id }).eq('id', row.id)

  after(() => broadcastMessageInserted({
    messageId: msg.id, roomId, conversationId: null, parentId: null, senderId: auth.userId,
  }).catch(() => {}))

  // The room is bridged to Slack (Chat Synx) at Heroes — a message inserted
  // here skips the messages route, so mirror it ourselves. Text only.
  after(() => bridgeHubMessageToChatSynx({
    messageId: msg.id, roomId, parentId: null, senderId: auth.userId,
    senderName, senderAvatarUrl: me?.avatar_url ?? null, content: lines.join('\n'),
  }).catch((e: Error) => console.error('[checks] slack mirror failed', e.message)))

  const { data: members } = await admin.from('room_members').select('user_id').eq('room_id', roomId)
  const recipients = (members ?? []).map(m => m.user_id as string).filter(id => id !== auth.userId)
  if (recipients.length) {
    after(() => sendHubPush(recipients, {
      title: `💵 Check from ${customerName}`,
      body: `${formatCents(amountCents)}${checkNumber ? ` · #${checkNumber}` : ''} — from ${senderName}`,
      url: `/hub/${roomId}`,
      type: 'room',
      groupKey: roomId,
    }, { roomId }).catch((e: Error) => console.error('[checks] push failed', e.message)))
  }

  return NextResponse.json({ id: row.id, posted: true })
}
