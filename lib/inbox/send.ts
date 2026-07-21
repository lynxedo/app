// Hub Inbox — outbound send helpers (reply + new compose).
//
// Both paths ALWAYS send AS the connected mailbox (account.email_address). That's
// inherent to Nylas — the grant IS the mailbox, so there's no per-user "from".
//
// Body contract (matches the composer):
//   • `bodyHtml` — full rich HTML from the composer. The composer already embedded
//     the sender's signature, so the server does NOT append one. We only wrap it in
//     a minimal font-default div for email-client compatibility.
//   • `bodyText` (the API routes' legacy `body` field) — plain/legacy body. Kept
//     byte-compatible with the original behavior: the server appends the sender's
//     signature ("-- \n{name}") exactly as before.
//   bodyHtml wins when both are present.
//
// Attachments: the routes pass `{ id, filename, contentType, size }` metas where
// `id` is the R2 outbox key minted by POST /api/hub/email/attachments. We validate
// the key's company prefix (no cross-company fetch), load the bytes from R2,
// enforce a 20 MB total cap (Nylas caps ~25 MB), send multipart, mirror the
// attachment meta onto the inbox_messages row, then best-effort delete the R2
// staging objects.
//
// Writes go through the service-role admin client; the ROUTE is responsible for
// the per-action permission check (getInboxThreadPermissions) before calling in.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getMailProvider } from './provider'
import type { InboxAccount } from './accounts'
import type { MailAttachment, MailParticipant, OutboundAttachmentFile } from './types'
import { r2GetBuffer, r2Delete } from '@/lib/r2'

export type SendResult =
  | { ok: true; messageId: string; threadId?: string }
  // `status` lets the route surface the right HTTP code (413 attachment cap, 400 bad ref) instead of a blanket 502.
  | { ok: false; error: string; status?: number }

// What the API routes accept per attachment (the upload route's response, echoed back).
export type OutboundAttachmentMeta = {
  id: string // R2 outbox key: inbox/{company_id}/outbox/{uuid}/{filename}
  filename?: string
  contentType?: string
  size?: number
}

const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024 // Nylas hard cap is ~25 MB; leave headroom for encoding.

// Parse the attachments[] the composer echoes back from POST /api/hub/email/attachments.
// Only the id is trusted for fetching (and re-validated against the company prefix below).
// Shared by the compose + reply routes (route files can't export helpers).
export function parseAttachmentMetas(raw: unknown): OutboundAttachmentMeta[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .filter((a) => typeof a.id === 'string' && (a.id as string).length > 0)
    .slice(0, 20)
    .map((a) => ({
      id: a.id as string,
      filename: typeof a.filename === 'string' ? a.filename : undefined,
      contentType: typeof a.contentType === 'string' ? a.contentType : undefined,
      size: typeof a.size === 'number' ? a.size : undefined,
    }))
}

// Strip HTML to plain text (used for the snippet + body_text mirror columns).
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

// Short plain-text snippet for the sidebar/search denorm.
function htmlToSnippet(html: string, max = 200): string {
  const text = htmlToText(html)
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

// "Re:"-normalize a subject: collapse any run of leading "Re:" into a single one.
function reSubject(subject: string | null | undefined): string {
  const base = (subject || '').replace(/^(\s*re\s*:\s*)+/i, '').trim()
  return base ? `Re: ${base}` : 'Re:'
}

// Resolve the sender's display name + signature. The mailbox sends the message;
// this is only for the appended human signature so the customer knows who wrote.
async function resolveSender(
  admin: SupabaseClient,
  userId: string
): Promise<{ displayName: string; signatureHtml: string }> {
  const [{ data: hu }, { data: prof }] = await Promise.all([
    admin.from('hub_users').select('display_name').eq('id', userId).maybeSingle(),
    admin.from('user_profiles').select('full_name, email_signature').eq('id', userId).maybeSingle(),
  ])
  const displayName =
    (hu?.display_name as string | undefined)?.trim() ||
    (prof?.full_name as string | undefined)?.trim() ||
    'Heroes Lawn Care'
  const signatureHtml = ((prof?.email_signature as string | undefined) || '').trim()
  return { displayName, signatureHtml }
}

// LEGACY path only: append the sender's signature block. Uses the standard "-- "
// delimiter so mail clients recognize it as a signature. Falls back to
// "{name}, Heroes Lawn Care" when the user hasn't set a personal signature.
// The rich `bodyHtml` path never calls this — the composer embeds the signature.
// TODO(multi-tenant): replace the hardcoded "Heroes Lawn Care" fallback with the
// tenant's business profile name once business_profiles is wired here.
function composeBody(bodyHtml: string, displayName: string, signatureHtml: string): string {
  const sig = signatureHtml || `${displayName}, Heroes Lawn Care`
  return `${bodyHtml}<br><br>-- <br>${sig}`
}

// Minimal email-client-compatible wrapper for composer HTML (font default only —
// the composer owns everything else, including the signature).
function wrapHtmlBody(html: string): string {
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5;">${html}</div>`
}

// Pick + finalize the outgoing HTML body per the contract above. Null → nothing to send.
function buildOutboundBody(
  params: { bodyHtml?: string | null; bodyText?: string | null },
  displayName: string,
  signatureHtml: string
): string | null {
  const rich = (params.bodyHtml || '').trim()
  if (rich) return wrapHtmlBody(rich)
  const legacy = (params.bodyText || '').trim()
  if (legacy) return composeBody(legacy, displayName, signatureHtml)
  return null
}

// Validate + load outbound attachments from the R2 outbox. Fails closed on any
// key outside this company's outbox prefix (no cross-company fetch).
async function loadOutboundAttachments(
  companyId: string,
  metas: OutboundAttachmentMeta[]
): Promise<
  | { ok: true; files: OutboundAttachmentFile[]; keys: string[] }
  | { ok: false; error: string; status: number }
> {
  const prefix = `inbox/${companyId}/outbox/`
  const files: OutboundAttachmentFile[] = []
  const keys: string[] = []
  let total = 0
  for (const meta of metas) {
    const key = typeof meta?.id === 'string' ? meta.id : ''
    if (!key.startsWith(prefix) || key.includes('..')) {
      return { ok: false, error: 'Invalid attachment reference', status: 400 }
    }
    let content: Buffer
    try {
      content = await r2GetBuffer(key)
    } catch {
      return { ok: false, error: `Attachment not found: ${meta.filename || 'file'}`, status: 400 }
    }
    total += content.length
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
      return { ok: false, error: 'Attachments exceed the 20 MB total limit', status: 413 }
    }
    files.push({
      filename: (meta.filename || key.split('/').pop() || 'attachment').slice(0, 255),
      contentType: meta.contentType || 'application/octet-stream',
      content,
    })
    keys.push(key)
  }
  return { ok: true, files, keys }
}

// Attachment meta to mirror onto inbox_messages.attachments. Prefer the provider's
// ids from the send response (they make the download route work immediately); fall
// back to the upload metas — the next sync overwrites with provider ids anyway.
function mirrorAttachments(
  sentAttachments: MailAttachment[] | undefined,
  metas: OutboundAttachmentMeta[]
): Array<{ id: string; filename?: string; contentType?: string; size?: number }> {
  if (sentAttachments && sentAttachments.length > 0) {
    return sentAttachments.map((a) => ({ id: a.id, filename: a.filename, contentType: a.contentType, size: a.size }))
  }
  return metas.map((m) => ({ id: m.id, filename: m.filename, contentType: m.contentType, size: m.size }))
}

// Best-effort cleanup of the R2 outbox staging objects after a successful send.
async function cleanupOutboxKeys(keys: string[]): Promise<void> {
  for (const key of keys) {
    try {
      await r2Delete(key)
    } catch {
      /* best-effort — orphaned staging objects are harmless */
    }
  }
}

/**
 * Reply to an existing thread. Sends AS the mailbox to the external customer,
 * threads onto the latest inbound message, mirrors the outbound message into
 * inbox_messages, bumps the thread, and logs a 'replied' event.
 */
export async function sendInboxReply(
  admin: SupabaseClient,
  params: {
    account: InboxAccount
    threadId: string
    userId: string
    bodyHtml?: string | null // rich HTML (composer-signed) — no server signature
    bodyText?: string | null // legacy plain body — server appends the signature
    attachments?: OutboundAttachmentMeta[]
    cc?: MailParticipant[]
    bcc?: MailParticipant[]
  }
): Promise<SendResult> {
  const { account, threadId, userId } = params
  const cc = params.cc || []
  const bcc = params.bcc || []
  const attachmentMetas = params.attachments || []

  // Load the thread for subject + fallback recipient.
  const { data: thread } = await admin
    .from('inbox_threads')
    .select('id, company_id, subject, from_name, from_email, participants')
    .eq('id', threadId)
    .maybeSingle()
  if (!thread) return { ok: false, error: 'Thread not found' }

  const selfEmail = (account.email_address || '').toLowerCase()

  // Find the recipient (the external party) + the message to thread onto. Prefer
  // the latest INBOUND message's sender (that's who we're replying to) and its
  // provider id for reply threading.
  const { data: msgs } = await admin
    .from('inbox_messages')
    .select('provider_message_id, direction, from_name, from_email, message_date')
    .eq('thread_id', threadId)
    .order('message_date', { ascending: false })
    .limit(50)

  const rows = (msgs || []) as Array<{
    provider_message_id: string
    direction: string
    from_name: string | null
    from_email: string | null
    message_date: string | null
  }>
  const latestInbound = rows.find((m) => m.direction === 'inbound' && m.from_email)
  const replyToMessageId = latestInbound?.provider_message_id || rows[0]?.provider_message_id

  let recipient: MailParticipant | null = null
  if (latestInbound?.from_email) {
    recipient = { email: latestInbound.from_email, name: latestInbound.from_name || undefined }
  } else if (thread.from_email && thread.from_email.toLowerCase() !== selfEmail) {
    recipient = { email: thread.from_email, name: thread.from_name || undefined }
  } else {
    // Fall back to a participant that isn't our own mailbox.
    const parts = (Array.isArray(thread.participants) ? thread.participants : []) as MailParticipant[]
    recipient = parts.find((p) => p?.email && p.email.toLowerCase() !== selfEmail) || null
  }

  if (!recipient?.email) return { ok: false, error: 'Could not determine a recipient for this thread' }

  const { displayName, signatureHtml } = await resolveSender(admin, userId)
  const composed = buildOutboundBody(params, displayName, signatureHtml)
  if (!composed) return { ok: false, error: 'Empty message', status: 400 }
  const subject = reSubject(thread.subject)

  // Load staged attachments from R2 (validates the company prefix + 20 MB cap).
  const loaded = await loadOutboundAttachments(thread.company_id as string, attachmentMetas)
  if (!loaded.ok) return loaded

  // Send via the transport (Nylas). Any provider error → soft failure.
  let sent: { providerMessageId: string; providerThreadId: string | null; attachments?: MailAttachment[] }
  try {
    sent = await getMailProvider(account).sendMessage({
      to: [recipient],
      cc,
      bcc,
      subject,
      bodyHtml: composed,
      replyToMessageId,
      trackReplies: true,
      attachments: loaded.files,
    })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[inbox:send] reply send failed', error)
    return { ok: false, error }
  }

  const now = new Date().toISOString()
  const hasAttachments = loaded.files.length > 0
  const mirroredAttachments = hasAttachments ? mirrorAttachments(sent.attachments, attachmentMetas) : []

  // Mirror the outbound message locally. UPSERT (not insert) on the provider-message unique key:
  // if a concurrent sync already ingested this just-sent message, an insert would hit 23505 and
  // wrongly report a send failure for mail that actually went out. Upsert makes it idempotent.
  const { data: inserted, error: insertErr } = await admin
    .from('inbox_messages')
    .upsert(
      {
        company_id: thread.company_id,
        thread_id: threadId,
        account_id: account.id,
        provider_message_id: sent.providerMessageId,
        direction: 'outbound',
        from_name: displayName,
        from_email: account.email_address,
        to_recipients: [recipient],
        cc_recipients: cc,
        bcc_recipients: bcc,
        subject,
        snippet: htmlToSnippet(composed),
        body_html: composed,
        body_text: htmlToText(composed),
        message_date: now,
        unread: false,
        has_attachments: hasAttachments,
        attachments: mirroredAttachments,
        sent_by_user_id: userId,
      },
      { onConflict: 'account_id,provider_message_id' }
    )
    .select('id')
    .single()

  if (insertErr || !inserted) {
    // The email DID go out; we just failed to mirror it. Surface a soft error so
    // the UI can refetch (the next sync will pick the message up regardless).
    console.error('[inbox:send] outbound mirror insert failed', insertErr?.message)
    return { ok: false, error: insertErr?.message || 'Message sent but failed to record' }
  }

  // Bump the thread. Do NOT auto-close — a reply keeps the thread open/assigned.
  await admin
    .from('inbox_threads')
    .update({
      last_message_at: now,
      last_message_direction: 'outbound',
      unread: false,
      updated_at: now,
    })
    .eq('id', threadId)

  await admin.from('inbox_thread_events').insert({
    company_id: thread.company_id,
    thread_id: threadId,
    event_type: 'replied',
    actor_user_id: userId,
    detail: { message_id: inserted.id },
  })

  await cleanupOutboxKeys(loaded.keys)

  return { ok: true, messageId: inserted.id }
}

/**
 * Start a NEW outbound as the mailbox (no existing thread). Sends, then best-effort
 * upserts a local inbox_threads row keyed on the provider thread id + mirrors the
 * outbound message. If the provider returns no thread id we skip the local rows
 * and let the next sync materialize the thread.
 */
export async function sendInboxNew(
  admin: SupabaseClient,
  params: {
    account: InboxAccount
    userId: string
    to: MailParticipant[]
    cc?: MailParticipant[]
    bcc?: MailParticipant[]
    subject: string
    bodyHtml?: string | null // rich HTML (composer-signed) — no server signature
    bodyText?: string | null // legacy plain body — server appends the signature
    attachments?: OutboundAttachmentMeta[]
  }
): Promise<SendResult> {
  const { account, userId } = params
  const to = params.to || []
  const cc = params.cc || []
  const bcc = params.bcc || []
  const attachmentMetas = params.attachments || []

  if (to.length === 0 || !to[0]?.email) return { ok: false, error: 'At least one recipient is required' }

  const { displayName, signatureHtml } = await resolveSender(admin, userId)
  const composed = buildOutboundBody(params, displayName, signatureHtml)
  if (!composed) return { ok: false, error: 'Empty message', status: 400 }
  const subject = (params.subject || '').trim() || '(no subject)'

  // Load staged attachments from R2 (validates the company prefix + 20 MB cap).
  const loaded = await loadOutboundAttachments(account.company_id, attachmentMetas)
  if (!loaded.ok) return loaded

  let sent: { providerMessageId: string; providerThreadId: string | null; attachments?: MailAttachment[] }
  try {
    sent = await getMailProvider(account).sendMessage({
      to,
      cc,
      bcc,
      subject,
      bodyHtml: composed,
      trackReplies: true,
      attachments: loaded.files,
    })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[inbox:send] new send failed', error)
    return { ok: false, error }
  }

  const now = new Date().toISOString()
  const hasAttachments = loaded.files.length > 0
  const mirroredAttachments = hasAttachments ? mirrorAttachments(sent.attachments, attachmentMetas) : []

  // No provider thread id → nothing to key a local row on; let sync materialize it.
  if (!sent.providerThreadId) {
    await cleanupOutboxKeys(loaded.keys)
    return { ok: true, messageId: sent.providerMessageId }
  }

  const isShared = account.account_type === 'shared'

  // Upsert the thread row (unique on account_id + provider_thread_id). The sender
  // owns it: a shared thread is assigned to them; a personal thread is theirs.
  const { data: threadRow, error: threadErr } = await admin
    .from('inbox_threads')
    .upsert(
      {
        company_id: account.company_id,
        account_id: account.id,
        provider_thread_id: sent.providerThreadId,
        subject,
        snippet: htmlToSnippet(composed),
        last_message_at: now,
        last_message_direction: 'outbound',
        // The conversation's "who" is the recipient (the customer), not our own mailbox —
        // the sidebar renders from_name/from_email as the other party.
        from_name: to[0]?.name ?? null,
        from_email: to[0]?.email ?? null,
        participants: to,
        is_shared: isShared,
        owner_user_id: isShared ? null : account.owner_user_id,
        assigned_to_user_id: isShared ? userId : null,
        status: isShared ? 'assigned' : 'open',
        unread: false,
        has_attachments: hasAttachments,
        updated_at: now,
      },
      { onConflict: 'account_id,provider_thread_id' }
    )
    .select('id')
    .single()

  if (threadErr || !threadRow) {
    console.error('[inbox:send] thread upsert failed', threadErr?.message)
    // Message still sent; the sync will reconcile.
    await cleanupOutboxKeys(loaded.keys)
    return { ok: true, messageId: sent.providerMessageId }
  }

  // Seat the sender as owner of a shared thread so it shows in their "mine".
  if (isShared) {
    await admin
      .from('inbox_thread_members')
      .insert({ thread_id: threadRow.id, user_id: userId, role: 'owner', added_by: userId })
      .then(({ error }) => {
        // Ignore duplicate PK (already seated); log anything else.
        if (error && error.code !== '23505') console.error('[inbox:send] seat owner failed', error.message)
      })
  }

  await admin.from('inbox_messages').upsert(
    {
      company_id: account.company_id,
      thread_id: threadRow.id,
      account_id: account.id,
      provider_message_id: sent.providerMessageId,
      direction: 'outbound',
      from_name: displayName,
      from_email: account.email_address,
      to_recipients: to,
      cc_recipients: cc,
      bcc_recipients: bcc,
      subject,
      snippet: htmlToSnippet(composed),
      body_html: composed,
      body_text: htmlToText(composed),
      message_date: now,
      unread: false,
      has_attachments: hasAttachments,
      attachments: mirroredAttachments,
      sent_by_user_id: userId,
    },
    { onConflict: 'account_id,provider_message_id' }
  )

  await cleanupOutboxKeys(loaded.keys)

  // threadId lets the composer land the sender directly in the new thread.
  return { ok: true, messageId: sent.providerMessageId, threadId: threadRow.id }
}
