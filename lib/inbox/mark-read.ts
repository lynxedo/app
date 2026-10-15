// Closing a thread in Hub marks it read in the mailbox too (Ben, Oct 15 2026), so
// Outlook's unread counts — shown beside each folder in Hub — stop counting mail
// the team has already handled. Thread-level, because older threads were mirrored
// header-only and we don't hold every message id.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getInboxAccountById } from './accounts'
import { getMailProvider } from './provider'
import { NylasError } from './nylas'

const MAX_RETRY_WAIT_MS = 10_000

/**
 * Mark one Hub thread read in the provider and in our mirror. Best-effort: never
 * throws (the close itself has already happened), retries once on a throttle.
 */
export async function markThreadReadInMailbox(admin: SupabaseClient, threadDbId: string): Promise<boolean> {
  try {
    const { data: thread } = await admin
      .from('inbox_threads')
      .select('id, account_id, provider_thread_id')
      .eq('id', threadDbId)
      .maybeSingle()
    if (!thread?.provider_thread_id) return false

    const account = await getInboxAccountById(admin, thread.account_id as string)
    if (!account) return false
    const provider = getMailProvider(account)

    try {
      await provider.setThreadFlags(thread.provider_thread_id as string, { unread: false })
    } catch (err) {
      if (!(err instanceof NylasError) || err.status !== 429) throw err
      await new Promise((r) => setTimeout(r, Math.min(err.retryAfterMs ?? 2000, MAX_RETRY_WAIT_MS)))
      await provider.setThreadFlags(thread.provider_thread_id as string, { unread: false })
    }

    await admin.from('inbox_threads').update({ unread: false }).eq('id', threadDbId)
    await admin.from('inbox_messages').update({ unread: false }).eq('thread_id', threadDbId).eq('unread', true)
    return true
  } catch (err) {
    console.warn('[inbox:mark-read] failed for thread', threadDbId, err instanceof Error ? err.message : err)
    return false
  }
}

/** Several threads, one at a time (Microsoft throttles bursts per mailbox). */
export async function markThreadsReadInMailbox(admin: SupabaseClient, threadDbIds: string[]): Promise<void> {
  for (const id of threadDbIds) {
    await markThreadReadInMailbox(admin, id)
  }
}
