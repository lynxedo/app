// Shared Inbox sync worker. Pulls one bounded page of threads (+ their messages)
// per connected mailbox from the mail provider (Nylas today) into the inbox_*
// mirror tables, so the Hub Inbox UI reads fast from Postgres and RLS enforces the
// technician thread-scoped boundary. The cron route (app/api/hub/email/sync) calls
// syncCompany repeatedly; each call advances the per-account page cursor.
//
// Two modes:
//   • normal (syncAccount/syncCompany) — the newest page only, every run (poller).
//   • backfill (backfillAccount/backfillCompany) — pages through history bounded by
//     `latest_message_after` (days window) up to maxPages pages, so older mail (in
//     folders) mirrors too. Same per-thread mirroring logic, shared via mirrorThread.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getMailProvider, type MailProvider } from './provider'
import type { InboxAccount } from './accounts'
import { getInboxAccountById } from './accounts'
import type { MailThread, MailMessage } from './types'
import { applyInboxRules } from './rules'
import { NylasError } from './nylas'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type AccountSyncResult = { threads: number; messages: number; error?: string }
export type CompanySyncResult = { accounts: number; threads: number; messages: number; errors: string[] }
export type AccountBackfillResult = { pages: number; threads: number; messages: number; error?: string }
export type CompanyBackfillResult = {
  accounts: number
  pages: number
  threads: number
  messages: number
  errors: string[]
}

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

// Mirror the mailbox's folders into inbox_folders and return the
// providerFolderId → display-name map used for thread folder labels.
async function syncFolders(
  admin: SupabaseClient,
  account: InboxAccount,
  provider: MailProvider,
  nowIso: string
): Promise<Map<string, string>> {
  const isShared = account.account_type === 'shared'
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
  return folderMap
}

// How far back a "new" thread's last activity may be for inbound rules to fire.
// The poller sees genuinely-new mail within minutes; this guard keeps a first
// sweep after connecting a mailbox (which surfaces older threads as "new" rows)
// from mass-firing assignment/move rules across history. Outlook semantics:
// rules act on ARRIVING mail only.
const RULES_RECENCY_MS = 48 * 60 * 60 * 1000

// Upsert a thread's messages into inbox_messages (idempotent on the provider
// message id). Returns how many rows were written. body_text + sent_by_user_id are
// intentionally omitted so a re-sync never clobbers Hub-authored values.
async function upsertMessages(
  admin: SupabaseClient,
  account: InboxAccount,
  threadDbId: string,
  messages: MailMessage[]
): Promise<number> {
  let count = 0
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
      },
      { onConflict: 'account_id,provider_message_id' }
    )
    if (!mErr) count++
  }
  return count
}

// On-demand body hydration for a header-only-backfilled thread (opened in Hub but
// its message bodies were never mirrored). Fetches the thread's messages from the
// provider and mirrors them. Caller must have already authorized the read.
export async function hydrateThreadMessages(
  admin: SupabaseClient,
  threadDbId: string,
  accountId: string,
  providerThreadId: string
): Promise<number> {
  const account = await getInboxAccountById(admin, accountId)
  if (!account) return 0
  const provider = getMailProvider(account)
  const messages = await provider.listMessages(providerThreadId)
  return upsertMessages(admin, account, threadDbId, messages)
}

// Mirror ONE provider thread into the inbox_* tables. Shared by the normal poller
// and the backfill pager so there is exactly one copy of the upsert/status/
// contact-link logic.
//   • applyRules — true only for the live poller; the backfill pager must never run
//     inbound rules over history.
//   • headerOnly — true for backfill: mirror the thread ROW only and DON'T fetch
//     message bodies (keeps a 12-month backfill light + off Microsoft's throttle;
//     bodies are hydrated lazily when a thread is opened — see the detail route).
async function mirrorThread(
  admin: SupabaseClient,
  account: InboxAccount,
  provider: MailProvider,
  t: MailThread,
  folderMap: Map<string, string>,
  nowIso: string,
  opts: { applyRules: boolean; headerOnly: boolean }
): Promise<{ mirrored: boolean; messages: number }> {
  const isShared = account.account_type === 'shared'
  const self = (account.email_address || '').toLowerCase()

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

  // Status rule: new → 'open'; a closed thread reopens ONLY on a GENUINELY NEW
  // inbound reply (its last-message time advanced past what we stored) — NOT on
  // every re-fetch, or Close would never stick for any customer-wrote-last thread
  // (the poll would reopen it each run). Otherwise keep the existing status (never
  // downgrade an 'assigned' thread to 'open' on sync).
  // Compare as epoch ms, not strings — the stored DB value ("…+00:00") and Nylas's
  // ("…Z") are the same instant but sort differently as strings (spurious reopen).
  // A small margin absorbs precision/format drift so an UNCHANGED thread never reopens.
  const REOPEN_MARGIN_MS = 5000
  const existingMs = existing?.last_message_at ? Date.parse(existing.last_message_at as string) : 0
  const incomingMs = t.lastMessageAt ? Date.parse(t.lastMessageAt) : 0
  const isNewerInbound =
    t.lastMessageDirection === 'inbound' && incomingMs > existingMs + REOPEN_MARGIN_MS
  let status: string
  if (!existing) {
    // NEW THREAD branch — inbound rules run after the messages mirror below.
    status = 'open'
  } else if (existing.status === 'closed' && isNewerInbound) {
    status = 'open'
  } else {
    status = existing.status as string
  }

  // Best-effort unified-directory link by sender email (never creates a
  // contact; a lookup hiccup must not abort the sweep).
  let contactId: string | undefined
  if (fromEmail) {
    try {
      const { data: c } = await admin
        .from('txt_contacts')
        .select('id')
        .eq('company_id', account.company_id)
        .ilike('email', fromEmail.replace(/([%_\\])/g, '\\$1'))
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
    return { mirrored: false, messages: 0 }
  }
  const threadDbId = up.id as string

  // Header-only (backfill): mirror the row and stop — no message-body fetch. Bodies
  // are hydrated on demand when the thread is opened. Rules never run in this mode.
  if (opts.headerOnly) return { mirrored: true, messages: 0 }

  // Only (re)fetch messages when the thread is new or its last activity moved,
  // so an unchanged thread isn't re-pulled every run.
  const needMessages = !existing || !sameInstant(existing.last_message_at as string | null, t.lastMessageAt)
  if (!needMessages) return { mirrored: true, messages: 0 }

  const messages = await provider.listMessages(t.providerThreadId)
  const messageCount = await upsertMessages(admin, account, threadDbId, messages)

  // Inbound rules — NEW shared-inbox threads only, live poller only, and only when
  // the activity is recent (see RULES_RECENCY_MS). The engine itself never throws,
  // but belt-and-braces here too: a rules hiccup must never fail the sweep.
  if (
    opts.applyRules &&
    !existing &&
    isShared &&
    t.lastMessageDirection === 'inbound' &&
    // No timestamp → recency unprovable → rules skip (safe default).
    !!t.lastMessageAt &&
    Date.now() - Date.parse(t.lastMessageAt) < RULES_RECENCY_MS
  ) {
    try {
      // Evaluate against the latest inbound message's content (fall back to the
      // thread snippet when the body is unavailable).
      const inbound = [...messages].reverse().find((m) => m.direction === 'inbound')
      const bodyText = (inbound?.bodyHtml
        ? inbound.bodyHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        : inbound?.snippet || t.snippet || ''
      ).slice(0, 20000)
      await applyInboxRules(admin, {
        companyId: account.company_id,
        accountId: account.id,
        threadDbId,
        providerThreadId: t.providerThreadId,
        subject: t.subject ?? null,
        fromEmail,
        fromName,
        toRecipients: inbound?.to ?? undefined,
        bodyText,
      })
    } catch (err) {
      console.warn('[inbox:sync] rules evaluation failed:', err instanceof Error ? err.message : err)
    }
  }

  return { mirrored: true, messages: messageCount }
}

// Sync a single mailbox: folders, then one page of threads (and, for new/changed
// threads, their messages). Never throws — records last_error on the account and
// returns it instead, so one bad mailbox can't abort a company sweep.
export async function syncAccount(admin: SupabaseClient, account: InboxAccount): Promise<AccountSyncResult> {
  let threadCount = 0
  let messageCount = 0
  const nowIso = new Date().toISOString()

  try {
    const provider = getMailProvider(account)

    // 1) Folders → inbox_folders (+ a providerFolderId→name map for thread display).
    const folderMap = await syncFolders(admin, account, provider, nowIso)

    // 2) Always pull the NEWEST page each run. Nylas returns threads ordered by most-recent
    // activity, so a poller must start fresh every time — resuming from a saved page_token walks
    // DEEPER into history and would miss newly-arrived mail (a real speed-to-reply bug). A thread
    // older than this page resurfaces here the moment it gets new activity, and upsert idempotency
    // keeps everything current. (Backfilling dormant old threads is what backfillAccount below is
    // for; a Graph/Gmail webhook feed replaces this polling later.)
    const { threads } = await provider.listThreads({
      limit: THREAD_PAGE_LIMIT,
    })

    for (const t of threads) {
      // Live poller: fetch bodies + run rules. It is the ONLY place inbound rules fire.
      const r = await mirrorThread(admin, account, provider, t, folderMap, nowIso, {
        applyRules: true,
        headerOnly: false,
      })
      if (r.mirrored) threadCount++
      messageCount += r.messages
    }

    // 3) Stamp the sweep. We always re-pull the newest page (see above), so there is no forward
    //    cursor to persist; sync_cursor is left for a future webhook/delta implementation.
    await admin
      .from('inbox_accounts')
      .update({ last_synced_at: nowIso, last_error: null, updated_at: nowIso })
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

// BACKFILL a single mailbox: page through up to maxPages pages of threads whose
// latest message falls inside the last `days` days, mirroring every page. Uses the
// exact same per-thread logic as the poller (mirrorThread). Never throws.
export async function backfillAccount(
  admin: SupabaseClient,
  account: InboxAccount,
  opts: { days: number; maxPages: number }
): Promise<AccountBackfillResult> {
  let pages = 0
  let threadCount = 0
  let messageCount = 0
  const nowIso = new Date().toISOString()
  const latestMessageAfter = Math.floor(Date.now() / 1000) - opts.days * 86400

  try {
    const provider = getMailProvider(account)
    const folderMap = await syncFolders(admin, account, provider, nowIso)

    let pageToken: string | undefined
    for (let page = 0; page < opts.maxPages; page++) {
      // Fetch a page, backing off + retrying on Microsoft's per-mailbox 429 rather
      // than aborting the whole backfill. Nylas' latest_message_after already bounds
      // the window, so the loop ends naturally when threads run out (no cursor).
      let result: { threads: MailThread[]; nextCursor: string | null } | null = null
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          result = await provider.listThreads({ limit: THREAD_PAGE_LIMIT, pageToken, latestMessageAfter })
          break
        } catch (e) {
          if (e instanceof NylasError && e.status === 429 && attempt < 5) {
            const wait = e.retryAfterMs ?? Math.min(30000, 2000 * (attempt + 1))
            console.warn(`[inbox:sync] backfill throttled (page ${page}); waiting ${wait}ms`)
            await sleep(wait)
            continue
          }
          throw e
        }
      }
      if (!result) break
      pages++
      for (const t of result.threads) {
        // headerOnly — mirror thread rows only (bodies hydrate on open); applyRules
        // false — rules must never mass-fire across 12 months of history.
        const r = await mirrorThread(admin, account, provider, t, folderMap, nowIso, {
          applyRules: false,
          headerOnly: true,
        })
        if (r.mirrored) threadCount++
        messageCount += r.messages
      }
      if (!result.nextCursor || result.threads.length === 0) break
      pageToken = result.nextCursor
      await sleep(400) // gentle inter-page pacing to stay under Microsoft's limits
    }

    await admin
      .from('inbox_accounts')
      .update({ last_synced_at: nowIso, last_error: null, updated_at: nowIso })
      .eq('id', account.id)

    return { pages, threads: threadCount, messages: messageCount }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[inbox:sync] backfill ${account.email_address} failed:`, message)
    try {
      await admin
        .from('inbox_accounts')
        .update({ last_error: message, updated_at: new Date().toISOString() })
        .eq('id', account.id)
    } catch {
      /* best-effort — don't mask the original error */
    }
    return { pages, threads: threadCount, messages: messageCount, error: message }
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

async function activeAccounts(admin: SupabaseClient, companyId: string): Promise<InboxAccount[]> {
  const { data } = await admin
    .from('inbox_accounts')
    .select('*')
    .eq('company_id', companyId)
    .eq('active', true)
  return (data ?? []) as InboxAccount[]
}

// Sync every active mailbox for a company, then broadcast one refresh nudge.
export async function syncCompany(admin: SupabaseClient, companyId: string): Promise<CompanySyncResult> {
  const accounts = await activeAccounts(admin, companyId)

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

// Backfill every active mailbox for a company (bounded window + page cap per mailbox).
export async function backfillCompany(
  admin: SupabaseClient,
  companyId: string,
  opts: { days: number; maxPages: number }
): Promise<CompanyBackfillResult> {
  const accounts = await activeAccounts(admin, companyId)

  let pages = 0
  let threads = 0
  let messages = 0
  const errors: string[] = []
  for (const acc of accounts) {
    const r = await backfillAccount(admin, acc, opts)
    pages += r.pages
    threads += r.threads
    messages += r.messages
    if (r.error) errors.push(`${acc.email_address}: ${r.error}`)
  }

  await broadcastInboxSync(admin, companyId)
  return { accounts: accounts.length, pages, threads, messages, errors }
}
