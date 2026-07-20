// Shared Inbox sync worker. Pulls one bounded page of threads (+ their messages)
// per connected mailbox from the mail provider (Nylas today) into the inbox_*
// mirror tables, so the Hub Inbox UI reads fast from Postgres and RLS enforces the
// technician thread-scoped boundary. The cron route (app/api/hub/email/sync) calls
// syncCompany repeatedly; each call advances the per-account page cursor.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getMailProvider } from './provider'
import type { InboxAccount } from './accounts'

export type AccountSyncResult = { threads: number; messages: number; error?: string }
export type CompanySyncResult = { accounts: number; threads: number; messages: number; errors: string[] }

const THREAD_PAGE_LIMIT = 50

// Same instant? DB timestamptz strings and our ISO strings differ textually for the
// same moment, so compare parsed epoch ms (used to skip refetching unchanged threads).
function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b
  return ta === tb
}

// Sync a single mailbox: folders, then one page of threads (and, for new/changed
// threads, their messages). Never throws — records last_error on the account and
// returns it instead, so one bad mailbox can't abort a company sweep.
export async function syncAccount(admin: SupabaseClient, account: InboxAccount): Promise<AccountSyncResult> {
  let threadCount = 0
  let messageCount = 0
  const nowIso = new Date().toISOString()
  const isShared = account.account_type === 'shared'
  const self = (account.email_address || '').toLowerCase()

  try {
    const provider = getMailProvider(account)

    // 1) Folders → inbox_folders (+ a providerFolderId→name map for thread display).
    const folderMap = new Map<string, string>()
    const folders = await provider.listFolders()
    for (const f of folders) {
      folderMap.set(f.providerFolderId, f.name)
      await admin.from('inbox_folders').upsert(
        {
          company_id: account.company_id,
          account_id: account.id,
          provider_folder_id: f.providerFolderId,
          name: f.name,
          parent_provider_folder_id: f.parentProviderFolderId,
          system_folder: f.systemFolder,
          is_shared: isShared,
          owner_user_id: account.owner_user_id,
          unread_count: f.unreadCount,
          total_count: f.totalCount,
          updated_at: nowIso,
        },
        { onConflict: 'account_id,provider_folder_id' }
      )
    }

    // 2) One bounded page of threads from the saved cursor.
    const { threads, nextCursor } = await provider.listThreads({
      limit: THREAD_PAGE_LIMIT,
      pageToken: account.sync_cursor || undefined,
    })

    for (const t of threads) {
      // From = first participant that isn't this mailbox (fall back to the first).
      const other =
        t.participants.find((p) => p.email && p.email.toLowerCase() !== self) || t.participants[0] || null
      const fromName = other?.name ?? null
      const fromEmail = other?.email ?? null

      // Existing row → status/reopen decision + skip-message optimization.
      const { data: existing } = await admin
        .from('inbox_threads')
        .select('id, status, last_message_at')
        .eq('account_id', account.id)
        .eq('provider_thread_id', t.providerThreadId)
        .maybeSingle()

      // Status rule: new → 'open'; a closed thread that gets a new inbound reply
      // reopens to 'open'; otherwise keep the existing status (never downgrade an
      // 'assigned' thread to 'open' on sync).
      let status: string
      if (!existing) status = 'open'
      else if (existing.status === 'closed' && t.lastMessageDirection === 'inbound') status = 'open'
      else status = existing.status as string

      // Best-effort unified-directory link by sender email (never creates a
      // contact; a lookup hiccup must not abort the sweep).
      let contactId: string | undefined
      if (fromEmail) {
        try {
          const { data: c } = await admin
            .from('txt_contacts')
            .select('id')
            .eq('company_id', account.company_id)
            .ilike('email', fromEmail)
            .limit(1)
            .maybeSingle()
          if (c?.id) contactId = c.id as string
        } catch {
          /* best-effort directory link */
        }
      }

      const folderName = t.providerFolderIds[0] ? folderMap.get(t.providerFolderIds[0]) ?? null : null

      const payload: Record<string, unknown> = {
        company_id: account.company_id,
        account_id: account.id,
        provider_thread_id: t.providerThreadId,
        subject: t.subject,
        snippet: t.snippet,
        participants: t.participants,
        from_name: fromName,
        from_email: fromEmail,
        last_message_at: t.lastMessageAt,
        last_message_direction: t.lastMessageDirection,
        unread: t.unread,
        has_attachments: t.hasAttachments,
        provider_folder_ids: t.providerFolderIds,
        folder: folderName,
        is_shared: isShared,
        owner_user_id: account.owner_user_id,
        status,
        updated_at: nowIso,
      }
      // Only set contact_id when matched so we never null an existing link.
      // assigned_to_user_id is intentionally never written here — sync must not
      // touch assignments.
      if (contactId) payload.contact_id = contactId

      const { data: up, error: upErr } = await admin
        .from('inbox_threads')
        .upsert(payload, { onConflict: 'account_id,provider_thread_id' })
        .select('id')
        .single()
      if (upErr || !up) {
        console.warn('[inbox:sync] thread upsert failed:', upErr?.message)
        continue
      }
      threadCount++
      const threadDbId = up.id as string

      // Only (re)fetch messages when the thread is new or its last activity moved,
      // so an unchanged thread isn't re-pulled every run.
      const needMessages = !existing || !sameInstant(existing.last_message_at as string | null, t.lastMessageAt)
      if (!needMessages) continue

      const messages = await provider.listMessages(t.providerThreadId)
      for (const m of messages) {
        const { error: mErr } = await admin.from('inbox_messages').upsert(
          {
            company_id: account.company_id,
            thread_id: threadDbId,
            account_id: account.id,
            provider_message_id: m.providerMessageId,
            direction: m.direction,
            from_name: m.from?.name ?? null,
            from_email: m.from?.email ?? null,
            to_recipients: m.to,
            cc_recipients: m.cc,
            bcc_recipients: m.bcc,
            subject: m.subject,
            snippet: m.snippet,
            body_html: m.bodyHtml,
            message_date: m.date,
            unread: m.unread,
            has_attachments: m.hasAttachments,
            attachments: m.attachments,
            provider_folder_ids: m.providerFolderIds,
            // body_text + sent_by_user_id intentionally omitted so a re-sync never
            // clobbers Hub-authored values on an existing row (upsert only SETs the
            // columns present here).
          },
          { onConflict: 'account_id,provider_message_id' }
        )
        if (!mErr) messageCount++
      }
    }

    // 3) Advance the cursor. null (page walk exhausted) → next run restarts from the
    //    newest threads, picking up fresh inbound.
    await admin
      .from('inbox_accounts')
      .update({ sync_cursor: nextCursor, last_synced_at: nowIso, last_error: null, updated_at: nowIso })
      .eq('id', account.id)

    return { threads: threadCount, messages: messageCount }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[inbox:sync] account ${account.email_address} failed:`, message)
    try {
      await admin
        .from('inbox_accounts')
        .update({ last_error: message, updated_at: new Date().toISOString() })
        .eq('id', account.id)
    } catch {
      /* best-effort — don't mask the original error */
    }
    return { threads: threadCount, messages: messageCount, error: message }
  }
}

// Best-effort realtime nudge so open Hub Inbox clients refresh after a sweep
// (mirrors the Txt `txt:${companyId}` broadcast pattern).
async function broadcastInboxSync(admin: SupabaseClient, companyId: string): Promise<void> {
  try {
    const ch = admin.channel(`inbox:${companyId}`)
    await ch.subscribe()
    await ch.send({ type: 'broadcast', event: 'sync', payload: {} })
    await admin.removeChannel(ch)
  } catch (err) {
    console.warn('[inbox:sync] broadcast failed', err)
  }
}

// Sync every active mailbox for a company, then broadcast one refresh nudge.
export async function syncCompany(admin: SupabaseClient, companyId: string): Promise<CompanySyncResult> {
  const { data } = await admin
    .from('inbox_accounts')
    .select('*')
    .eq('company_id', companyId)
    .eq('active', true)
  const accounts = (data ?? []) as InboxAccount[]

  let threads = 0
  let messages = 0
  const errors: string[] = []
  for (const acc of accounts) {
    const r = await syncAccount(admin, acc)
    threads += r.threads
    messages += r.messages
    if (r.error) errors.push(`${acc.email_address}: ${r.error}`)
  }

  await broadcastInboxSync(admin, companyId)
  return { accounts: accounts.length, threads, messages, errors }
}
