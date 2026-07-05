import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { pushBadgeUpdate } from '@/lib/hub-badges'

async function broadcastReceiptUpdated(conversationId: string, userId: string, lastReadAt: string) {
  const admin = createAdminClient()
  const channel = admin.channel(`receipts:${conversationId}`)
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('subscribe timeout')), 5000)
      channel.subscribe((status) => {
        const s = String(status)
        if (s === 'SUBSCRIBED') { clearTimeout(timeout); resolve() }
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') { clearTimeout(timeout); reject(new Error(s)) }
      })
    })
    await channel.send({ type: 'broadcast', event: 'receipt-updated', payload: { user_id: userId, last_read_at: lastReadAt } })
  } catch (err) {
    console.warn('[read-receipts] broadcast failed:', (err as Error).message)
  } finally {
    await admin.removeChannel(channel)
  }
}

// GET — returns unread room IDs and conversation IDs for the current user
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  // Latest message per room + per conversation, aggregated server-side.
  // Used to scan every message in the company on every call (79k+ rows).
  const [unreadStateResult, receiptsResult] = await Promise.all([
    supabase.rpc('get_unread_state_for_user', {
      p_user_id: user.id,
      p_company_id: profile.company_id,
    }),
    supabase
      .from('hub_read_receipts')
      .select('room_id, conversation_id, last_read_at')
      .eq('user_id', user.id),
  ])

  const receiptRoomMap: Record<string, string> = {}
  const receiptConvMap: Record<string, string> = {}
  for (const r of receiptsResult.data ?? []) {
    if (r.room_id) receiptRoomMap[r.room_id] = r.last_read_at
    if (r.conversation_id) receiptConvMap[r.conversation_id] = r.last_read_at
  }

  const latestByRoom: Record<string, string> = {}
  const latestByConv: Record<string, string> = {}
  for (const row of (unreadStateResult.data ?? []) as { scope: string; scope_id: string; last_at: string }[]) {
    if (row.scope === 'room') latestByRoom[row.scope_id] = row.last_at
    else if (row.scope === 'conversation') latestByConv[row.scope_id] = row.last_at
  }

  const unread_room_ids = Object.entries(latestByRoom)
    .filter(([roomId, latestAt]) => {
      const readAt = receiptRoomMap[roomId]
      return !readAt || latestAt > readAt
    })
    .map(([id]) => id)

  const unread_conv_ids = Object.entries(latestByConv)
    .filter(([convId, latestAt]) => {
      const readAt = receiptConvMap[convId]
      return !readAt || latestAt > readAt
    })
    .map(([id]) => id)

  const daily_log_unread = await computeDailyLogUnread(user.id, profile.company_id)

  return NextResponse.json({ unread_room_ids, unread_conv_ids, daily_log_unread })
}

// Whether this user has any unseen Daily Log v1 update since they last opened
// Daily Log. "Seen" = an update on an entry the user is a MEMBER of — assigned
// tech(s), an admin-configured always-notify user, or a Follower — posted by
// someone else after their last_read_at. Mirrors the DM/Room unread model but
// collapsed to a single boolean since Daily Log is one nav entry, not a list.
// Computed via the admin client and self-scoped to the authenticated user.
async function computeDailyLogUnread(userId: string, companyId: string): Promise<boolean> {
  const admin = createAdminClient()

  const [readReceiptRes, settingsRes] = await Promise.all([
    admin
      .from('daily_log_read_receipts')
      .select('last_read_at')
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('daily_log_settings')
      .select('update_notify_user_ids')
      .eq('company_id', companyId)
      .maybeSingle(),
  ])

  // Never opened Daily Log → baseline is epoch (any qualifying update is unread,
  // same as a never-opened Room). Clears the moment they open the page.
  const lastRead = readReceiptRes.data?.last_read_at ?? '1970-01-01T00:00:00Z'
  const alwaysNotify = ((settingsRes.data?.update_notify_user_ids ?? []) as string[]).includes(userId)

  // Admin always-notify users get the dot for ANY company update by others.
  if (alwaysNotify) {
    const { data } = await admin
      .from('daily_log_updates')
      .select('id')
      .eq('company_id', companyId)
      .neq('created_by', userId)
      .gt('created_at', lastRead)
      .limit(1)
    return (data?.length ?? 0) > 0
  }

  // Otherwise: only updates on entries the user belongs to. Bound assigned
  // entries to the last 30 days — older entries don't gain new updates and this
  // keeps the IN list small. Subscribed entries are naturally few per user.
  const sinceDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  const [assignedRes, subbedRes] = await Promise.all([
    admin
      .from('daily_log_entries')
      .select('id')
      .eq('company_id', companyId)
      .gte('log_date', sinceDate)
      .or(`tech_user_id.eq.${userId},secondary_tech_user_ids.cs.{${userId}}`),
    admin
      .from('daily_log_subscribers')
      .select('entry_id')
      .eq('user_id', userId),
  ])

  const entryIds = new Set<string>()
  for (const e of (assignedRes.data ?? []) as { id: string }[]) entryIds.add(e.id)
  for (const s of (subbedRes.data ?? []) as { entry_id: string }[]) entryIds.add(s.entry_id)
  if (entryIds.size === 0) return false

  const { data } = await admin
    .from('daily_log_updates')
    .select('id')
    .in('entry_id', [...entryIds])
    .neq('created_by', userId)
    .gt('created_at', lastRead)
    .limit(1)
  return (data?.length ?? 0) > 0
}

// POST — mark a room or conversation as read (upsert)
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const body = await request.json()
  const { room_id, conversation_id, daily_log } = body

  // Mark Daily Log read — fired when the user opens /hub/daily-log. Self-scoped
  // upsert via the admin client (one row per user).
  if (daily_log === true) {
    const nowIso = new Date().toISOString()
    await createAdminClient()
      .from('daily_log_read_receipts')
      .upsert(
        { user_id: user.id, company_id: profile.company_id, last_read_at: nowIso, updated_at: nowIso },
        { onConflict: 'user_id' },
      )
    return NextResponse.json({ ok: true })
  }

  if (!room_id && !conversation_id) return NextResponse.json({ error: 'room_id or conversation_id required' }, { status: 400 })

  // Defense in depth (test-findings #11): room_id/conversation_id are UUID
  // columns. Reject a non-UUID value with a clean 400 instead of letting the
  // upsert throw a "invalid input syntax for type uuid" that only surfaces in
  // the Postgres logs. (The HubSidebar caller already guards, this is a backstop.)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (room_id && !UUID_RE.test(room_id)) return NextResponse.json({ error: 'invalid room_id' }, { status: 400 })
  if (conversation_id && !UUID_RE.test(conversation_id)) return NextResponse.json({ error: 'invalid conversation_id' }, { status: 400 })

  const record: {
    company_id: string
    user_id: string
    room_id?: string
    conversation_id?: string
    last_read_at: string
  } = {
    company_id: profile.company_id,
    user_id: user.id,
    last_read_at: new Date().toISOString(),
  }
  if (room_id) record.room_id = room_id
  if (conversation_id) record.conversation_id = conversation_id

  const conflictCol = room_id ? 'user_id,room_id' : 'user_id,conversation_id'

  await supabase
    .from('hub_read_receipts')
    .upsert(record, { onConflict: conflictCol })

  // Broadcast receipt update for DMs so the sender's "Read" indicator
  // appears immediately even when postgres_changes drops the WAL event.
  if (conversation_id) {
    after(() => broadcastReceiptUpdated(conversation_id, user.id, record.last_read_at))
  }

  // Push the new lower badge count to this user's other devices so reading
  // on phone clears the iPad badge too. Post-response via after() — never
  // blocks the read-receipt response on push delivery.
  after(() => pushBadgeUpdate(createAdminClient(), user.id, profile.company_id)
    .catch((err: Error) => console.error('[read-receipts] badge update failed:', err.message)))

  return NextResponse.json({ ok: true })
}
