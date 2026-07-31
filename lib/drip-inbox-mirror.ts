// Mirror a drip email that was SENT via Resend into the Shared Inbox, so it shows
// up in the Inbox app's Sent-folder view. Drip → Settings deliberately keeps Resend
// as the sender (rather than sending through the hlc105 mailbox) to protect the
// primary mailbox's deliverability reputation and keep the marketing infra
// (tracking, one-click unsubscribe, suppression). This writes a LOGGED COPY of the
// sent email so it's still visible in the Inbox — it never touches Microsoft.
//
// Safety re: the Nylas sync: the rows are keyed on synthetic `drip:` provider ids.
// The inbox webhook/reconcile soft-deletes only rows it can match to a real
// provider id from a provider event (message.deleted / folder.delete) — a `drip:`
// id is never named by Nylas, so a mirror row is never touched by sync.
//
// Grouping: one thread per customer email (`drip:{email}`), so every drip email to
// a lead collects into one thread. Best-effort: any failure here MUST NOT affect
// the real send (the whole body is wrapped in try/catch).

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSharedAccount } from '@/lib/inbox/accounts'

type Admin = SupabaseClient

function snippetOf(html: string, max = 200): string {
  const text = (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

export async function mirrorDripEmailToInbox(
  admin: Admin,
  opts: {
    companyId: string
    toEmail: string
    toName?: string | null
    fromEmail: string
    fromName?: string | null
    subject: string
    bodyHtml: string
    providerRef?: string | null // Resend id → makes the synthetic message id unique + traceable
    sentByUserId?: string | null // drip "send as" user (e.g. Amber) — staff-author pointer for display
  },
): Promise<void> {
  try {
    const account = await getSharedAccount(admin, opts.companyId)
    if (!account) return // no connected shared mailbox → nothing to mirror into

    // Resolve the account's Sent system folder so the mirror lands in the Sent view.
    const { data: sentFolder } = await (admin.from('inbox_folders') as any)
      .select('provider_folder_id')
      .eq('account_id', account.id)
      .eq('system_folder', 'sent')
      .limit(1)
      .maybeSingle()
    const sentFolderId: string | null = sentFolder?.provider_folder_id ?? null
    const folderIds = sentFolderId ? [sentFolderId] : []

    const emailLower = opts.toEmail.trim().toLowerCase()
    if (!emailLower) return
    const nowIso = new Date().toISOString()
    const snippet = snippetOf(opts.bodyHtml)
    const providerThreadId = `drip:${emailLower}`
    const providerMessageId = `drip:${opts.providerRef || (globalThis.crypto?.randomUUID?.() ?? String(Date.now()))}`

    // Best-effort unified-directory link by the lead's email.
    let contactId: string | null = null
    try {
      const { data: c } = await (admin.from('txt_contacts') as any)
        .select('id')
        .eq('company_id', opts.companyId)
        .ilike('email', emailLower)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
      contactId = c?.id ?? null
    } catch {
      /* ignore directory-link failure */
    }

    // Upsert the thread (one per lead email) so multiple drip emails group together.
    const { data: thread } = await (admin.from('inbox_threads') as any)
      .upsert(
        {
          company_id: opts.companyId,
          account_id: account.id,
          provider_thread_id: providerThreadId,
          subject: opts.subject,
          snippet,
          last_message_at: nowIso,
          last_message_direction: 'outbound',
          from_name: opts.fromName ?? null,
          from_email: opts.fromEmail,
          participants: [{ name: opts.toName ?? null, email: opts.toEmail }],
          status: 'open',
          is_shared: true,
          unread: false,
          folder: 'Sent',
          provider_folder_ids: folderIds,
          contact_id: contactId,
          updated_at: nowIso,
        },
        { onConflict: 'account_id,provider_thread_id' },
      )
      .select('id')
      .maybeSingle()
    if (!thread?.id) return

    await (admin.from('inbox_messages') as any).insert({
      company_id: opts.companyId,
      thread_id: thread.id,
      account_id: account.id,
      provider_message_id: providerMessageId,
      direction: 'outbound',
      from_name: opts.fromName ?? null,
      from_email: opts.fromEmail,
      to_recipients: [{ name: opts.toName ?? null, email: opts.toEmail }],
      subject: opts.subject,
      snippet,
      body_html: opts.bodyHtml,
      message_date: nowIso,
      unread: false,
      sent_by_user_id: opts.sentByUserId ?? null,
      provider_folder_ids: folderIds,
    })
  } catch {
    // Never let a mirror failure affect the real send.
  }
}
