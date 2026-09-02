import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { listAccessibleAccounts } from '@/lib/inbox/accounts'
import { getInboxUserFlags } from '@/lib/inbox/permissions'

// GET /api/hub/email/unread → { latest_inbound_at: string | null, last_seen_at: string | null }
//
// The newest inbound-mail timestamp across the Inbox threads this user should be
// alerted about, so the Hub rail can light a dot. Deliberately the same shape and
// the same semantics as /api/txt/unread: the rail compares this against the LATER
// of a per-device stamp and the server-side per-user `inbox_last_seen_at`, so
// reading on one device clears the dot on the others.
//
// "Should be alerted about" matches what the THREADS LIST actually shows that
// user — a dot that lights for something the screen won't show is worse than no
// dot at all. So, per account:
//   · never closed, never soft-deleted, never currently snoozed
//   · last message must be INBOUND (a thread we already replied to isn't waiting)
//   · still holding a message in the Inbox folder (the same Outlook-mirror gate
//     the list route applies), so archived/sent-only threads drop off
//   · shared mailbox → threads assigned to me, threads shared with me, plus (for
//     managers only, who are the only ones allowed to VIEW that scope) the
//     unassigned open queue. A thread claimed by someone else never lights
//     another user's dot.
//   · personal mailbox → whatever RLS lets the owner see
//
// Note this is a "newer than when you last looked" signal, NOT an unhandled
// count: a long-standing backlog can't keep the dot lit, only new mail can.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, inbox_last_seen_at')
    .eq('id', user.id)
    .maybeSingle()

  const lastSeenAt = (profile?.inbox_last_seen_at as string | null) ?? null
  const companyId = (profile?.company_id as string | null) ?? null
  const none = NextResponse.json({ latest_inbound_at: null, last_seen_at: lastSeenAt })
  if (!companyId) return none

  const admin = createAdminClient()
  const flags = await getInboxUserFlags(supabase, user.id)

  // Both mailboxes the user can reach — one rail icon covers the whole Inbox, so
  // the dot has to. A user with neither gets an empty list and no dot.
  const accounts = await listAccessibleAccounts(admin, companyId, user.id, flags.hasAccess)
  if (accounts.length === 0) return none

  // Threads shared with me (thread-scoped access, Decision C) — the same lookup
  // the list route's `mine` scope uses.
  const { data: memberRows } = await supabase
    .from('inbox_thread_members')
    .select('thread_id')
    .eq('user_id', user.id)
  const myThreadIds = (memberRows ?? []).map((r) => r.thread_id as string)

  const nowIso = new Date().toISOString()
  let newest: string | null = null

  for (const account of accounts) {
    // The account's Inbox folder id, so this matches the list route's default
    // Outlook-mirror view. Resolved per account — two mailboxes have different
    // provider folder ids, which is why this loops instead of querying once.
    const { data: inb } = await admin
      .from('inbox_folders')
      .select('provider_folder_id')
      .eq('account_id', account.id)
      .eq('system_folder', 'inbox')
      .limit(1)
      .maybeSingle()
    const inboxFolderId = (inb?.provider_folder_id as string) || null

    // Reads go through the COOKIE client so RLS applies — this can never surface
    // a thread the caller isn't allowed to see, whatever the filters below say.
    let q = supabase
      .from('inbox_threads')
      .select('last_message_at')
      .eq('account_id', account.id)
      .is('deleted_at', null)
      .neq('status', 'closed')
      .eq('last_message_direction', 'inbound')
      .not('last_message_at', 'is', null)
      .order('last_message_at', { ascending: false })
      .limit(1)

    if (account.account_type === 'personal') {
      // RLS already restricts a personal mailbox to its owner; queue scopes don't
      // apply to it at all.
    } else {
      const parts = [`assigned_to_user_id.eq.${user.id}`]
      if (myThreadIds.length > 0) parts.push(`id.in.(${myThreadIds.join(',')})`)
      // Managers are the only ones the list route lets view the unassigned queue
      // (it 403s everyone else), so they're the only ones it may dot for.
      if (flags.isManager) parts.push('and(status.eq.open,assigned_to_user_id.is.null)')
      q = q.or(parts.join(','))
    }

    // Active views hide a currently-snoozed thread; it returns on its own when
    // the snooze passes, and should light the dot then, not now.
    q = q.or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)

    if (inboxFolderId) q = q.contains('provider_folder_ids', [inboxFolderId])

    const { data, error } = await q
    if (error) continue // one bad mailbox must not blank the whole signal
    const ts = (data?.[0]?.last_message_at as string | undefined) ?? null
    if (ts && (!newest || ts > newest)) newest = ts
  }

  return NextResponse.json({ latest_inbound_at: newest, last_seen_at: lastSeenAt })
}
