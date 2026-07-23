// Nylas webhook processing: record each raw delivery for idempotency/debugging, then
// dispatch by trigger type into the inbox_* mirror. Called from app/api/hub/email/webhook
// inside after() so the endpoint answers Nylas fast while the real work runs post-response.
//
// Invariants:
//   • Idempotent: the (provider, event_id) unique index dedupes redelivery. All
//     handlers are also individually re-runnable (mirror = upsert, DM guarded by
//     reconnect_notified_at, delivery/flag updates are set-to-a-value).
//   • Never hard-DELETE mirror rows — trashed mail is soft-deleted via deleted_at.
//   • processInboxEvent NEVER throws to the caller: a bad event is recorded as
//     status='error' and swallowed so one poisoned delivery can't crash the endpoint.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { NylasNotification } from './webhook'
import type { InboxAccount } from './accounts'
import { getMailProvider } from './provider'
import { mirrorThreadById, broadcastInboxUpdate } from './sync'
import { postGuardianToUserDm } from '@/lib/guardian-post'
import { sendHubPush } from '@/lib/hub-push'

// An inbox_accounts row plus the two columns the grant.* handlers need that the shared
// InboxAccount select (accounts.ts) doesn't carry.
type WebhookAccount = InboxAccount & {
  connected_by: string | null
  reconnect_notified_at: string | null
}

const ACCOUNT_COLS =
  'id, company_id, provider, underlying_provider, nylas_grant_id, account_type, email_address, display_name, owner_user_id, connected_by, reconnect_notified_at, sync_cursor, last_synced_at, last_error, status, active'

// Resolve the grant id from either the envelope or the trigger object (v3 puts it in
// both places depending on the trigger family).
function resolveGrantId(n: NylasNotification): string | null {
  return n.data?.grant_id ?? n.data?.object?.grant_id ?? null
}

// Patch the raw-event row by its natural key (never rethrows — status bookkeeping must
// not mask the real outcome).
async function markEvent(
  admin: SupabaseClient,
  n: NylasNotification,
  patch: Record<string, unknown>
): Promise<void> {
  try {
    await admin
      .from('inbox_events_raw')
      .update(patch)
      .eq('provider', 'nylas')
      .eq('event_id', n.id)
  } catch (err) {
    console.warn('[inbox:webhook] markEvent failed', err)
  }
}

// Record the raw delivery. Uniqueness is enforced by a PARTIAL unique index on
// (provider, event_id) — which can't be a PostgREST upsert onConflict target
// (a known gotcha in this codebase), so we plain-INSERT and treat a 23505 unique
// violation as "already delivered". Returns isNew=false for duplicates so the caller
// skips reprocessing. On any OTHER insert error we still return isNew=true: every
// handler is idempotent, so processing an un-recorded event is safe and preferable to
// dropping real mail because the audit insert hiccuped.
export async function recordRawEvent(
  admin: SupabaseClient,
  n: NylasNotification
): Promise<{ isNew: boolean; rowId: string | null }> {
  const { data, error } = await admin
    .from('inbox_events_raw')
    .insert({
      provider: 'nylas',
      event_id: n.id,
      trigger_type: n.type,
      grant_id: resolveGrantId(n),
      payload: n,
    })
    .select('id')
    .single<{ id: string }>()

  if (error) {
    // 23505 = unique_violation → this is a redelivery of an event we already have.
    if ((error as { code?: string }).code === '23505') return { isNew: false, rowId: null }
    console.warn('[inbox:webhook] recordRawEvent insert failed (processing anyway):', error.message)
    return { isNew: true, rowId: null }
  }
  return { isNew: true, rowId: data?.id ?? null }
}

// Find the active mailbox for a grant, including the two grant-handler-only columns.
async function findAccountByGrant(
  admin: SupabaseClient,
  grantId: string
): Promise<WebhookAccount | null> {
  const { data } = await admin
    .from('inbox_accounts')
    .select(ACCOUNT_COLS)
    .eq('nylas_grant_id', grantId)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
  const row = (data && data[0]) as WebhookAccount | undefined
  return row ?? null
}

// Build the set of provider folder ids that mean "trash / junk" for this mailbox, so a
// message.updated that lands ONLY in one of them can be treated as a delete.
async function trashFolderIds(account: InboxAccount): Promise<Set<string>> {
  const provider = getMailProvider(account)
  const folders = await provider.listFolders()
  const ids = new Set<string>()
  for (const f of folders) {
    if (f.systemFolder === 'trash' || f.systemFolder === 'spam') ids.add(f.providerFolderId)
  }
  return ids
}

// message.created / message.updated: re-mirror the named thread, then (for updates that
// move a message wholly into trash/junk) soft-delete that message and, if it was the
// thread's last surviving message, the thread too.
async function handleMessageUpsert(
  admin: SupabaseClient,
  account: WebhookAccount,
  n: NylasNotification
): Promise<void> {
  const obj = (n.data?.object || {}) as {
    id?: string
    thread_id?: string
    folders?: string[]
  }
  const providerMessageId = obj.id ?? null

  // Prefer the thread id on the event; fall back to fetching the message to learn it.
  let providerThreadId = obj.thread_id ?? null
  if (!providerThreadId && providerMessageId) {
    try {
      const msg = await getMailProvider(account).getMessage(providerMessageId)
      providerThreadId = msg.providerThreadId
    } catch (err) {
      console.warn('[inbox:webhook] getMessage (for thread id) failed', err)
    }
  }
  if (!providerThreadId) {
    await markEvent(admin, n, { status: 'skipped', processed_at: new Date().toISOString() })
    return
  }

  const threadDbId = await mirrorThreadById(admin, account, providerThreadId, { applyRules: true })

  // Trash handling — updates only. If the message's folders are now ONLY trash/junk,
  // it left the visible mailbox; soft-delete our mirror row (idempotent — an already
  // set deleted_at survives mirrorThread's re-upsert, which never writes deleted_at).
  if (n.type === 'message.updated' && providerMessageId && (obj.folders?.length ?? 0) > 0) {
    try {
      const trashIds = await trashFolderIds(account)
      const onlyTrash = (obj.folders as string[]).every((id) => trashIds.has(id))
      if (onlyTrash) {
        const nowIso = new Date().toISOString()
        await admin
          .from('inbox_messages')
          .update({ deleted_at: nowIso })
          .eq('account_id', account.id)
          .eq('provider_message_id', providerMessageId)
          .is('deleted_at', null)

        if (threadDbId) {
          // If no non-deleted messages remain, the whole thread is gone → soft-delete it.
          const { count } = await admin
            .from('inbox_messages')
            .select('id', { count: 'exact', head: true })
            .eq('thread_id', threadDbId)
            .is('deleted_at', null)
          if (!count) {
            await admin
              .from('inbox_threads')
              .update({ deleted_at: nowIso, updated_at: nowIso })
              .eq('id', threadDbId)
              .is('deleted_at', null)
          }
        }
      }
    } catch (err) {
      console.warn('[inbox:webhook] trash handling failed', err)
    }
  }

  if (threadDbId) await broadcastInboxUpdate(admin, account.company_id, threadDbId)
}

// grant.expired: the mailbox connection needs re-auth. Flag it and DM the owner once.
async function handleGrantExpired(
  admin: SupabaseClient,
  account: WebhookAccount
): Promise<void> {
  const nowIso = new Date().toISOString()
  await admin
    .from('inbox_accounts')
    .update({
      status: 'action_needed',
      last_error: 'Mailbox connection expired — reconnect required',
      updated_at: nowIso,
    })
    .eq('id', account.id)

  // Notify once (reconnect_notified_at is the dedupe guard so a storm of expiry events
  // can't spam the owner). No user to reach → still flip status, just skip the DM.
  const notifyUserId = account.connected_by ?? account.owner_user_id
  if (notifyUserId && !account.reconnect_notified_at) {
    const body = `Your shared inbox mailbox (${account.email_address}) disconnected and needs to be reconnected. Open Admin → Integrations → Shared Inbox to reconnect it.`
    try {
      await postGuardianToUserDm(account.company_id, notifyUserId, body, { admin })
    } catch (err) {
      console.warn('[inbox:webhook] reconnect DM failed', err)
    }
    try {
      await sendHubPush(
        [notifyUserId],
        {
          title: 'Mailbox needs reconnecting',
          body: `${account.email_address} disconnected — reconnect it in Admin → Integrations.`,
          url: '/hub/admin/integrations',
          type: 'inbox_reconnect',
        },
        { isDm: true }
      )
    } catch (err) {
      console.warn('[inbox:webhook] reconnect push failed', err)
    }
    await admin
      .from('inbox_accounts')
      .update({ reconnect_notified_at: nowIso })
      .eq('id', account.id)
  }
}

// bounced / rejected / complaint / delivered: stamp the outbound message's delivery state.
async function handleDeliveryEvent(
  admin: SupabaseClient,
  account: WebhookAccount,
  n: NylasNotification,
  status: 'bounced' | 'rejected' | 'complaint' | 'delivered'
): Promise<void> {
  const obj = (n.data?.object || {}) as Record<string, unknown>
  const messageId =
    (obj.message_id as string | undefined) ?? (obj.id as string | undefined) ?? null
  if (!messageId) return // nothing to match — best-effort

  const detail =
    (obj.bounce_reason as string | undefined) ??
    (obj.reason as string | undefined) ??
    (obj.description as string | undefined) ??
    (obj.error as string | undefined) ??
    null

  await admin
    .from('inbox_messages')
    .update({
      delivery_status: status,
      delivery_detail: detail ? String(detail).slice(0, 500) : null,
    })
    .eq('account_id', account.id)
    .eq('provider_message_id', messageId)
    .eq('direction', 'outbound')
}

// Dispatch one notification. Resolves the mailbox, switches on trigger type, and records
// the raw event's terminal status. NEVER rethrows.
export async function processInboxEvent(admin: SupabaseClient, n: NylasNotification): Promise<void> {
  try {
    const grantId = resolveGrantId(n)

    // grant.created is informational — the OAuth callback owns connection state.
    if (n.type === 'grant.created') {
      console.log('[inbox:webhook] grant.created (no-op)', grantId)
      await markEvent(admin, n, { status: 'processed', processed_at: new Date().toISOString() })
      return
    }

    if (!grantId) {
      await markEvent(admin, n, { status: 'skipped', processed_at: new Date().toISOString() })
      return
    }

    const account = await findAccountByGrant(admin, grantId)
    if (!account) {
      // No connected mailbox for this grant (e.g. disconnected, or another app's grant).
      await markEvent(admin, n, { status: 'skipped', processed_at: new Date().toISOString() })
      return
    }

    switch (n.type) {
      case 'message.created':
      case 'message.updated':
        await handleMessageUpsert(admin, account, n)
        break
      case 'grant.expired':
        await handleGrantExpired(admin, account)
        break
      case 'grant.deleted':
        await admin
          .from('inbox_accounts')
          .update({ status: 'disconnected', active: false, updated_at: new Date().toISOString() })
          .eq('id', account.id)
        break
      case 'message.bounced':
        await handleDeliveryEvent(admin, account, n, 'bounced')
        break
      case 'message.rejected':
        await handleDeliveryEvent(admin, account, n, 'rejected')
        break
      case 'message.complaint':
        await handleDeliveryEvent(admin, account, n, 'complaint')
        break
      case 'message.delivered':
        await handleDeliveryEvent(admin, account, n, 'delivered')
        break
      default:
        await markEvent(admin, n, { status: 'skipped', processed_at: new Date().toISOString() })
        return
    }

    await markEvent(admin, n, { status: 'processed', processed_at: new Date().toISOString() })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[inbox:webhook] processInboxEvent error:', message)
    await markEvent(admin, n, {
      status: 'error',
      process_error: message.slice(0, 1000),
      processed_at: new Date().toISOString(),
    })
    // Deliberately do not rethrow — a bad event must not crash the endpoint.
  }
}
