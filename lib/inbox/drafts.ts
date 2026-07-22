// Hub Inbox — draft (WIP compose) persistence helpers.
//
// A draft is a per-user work-in-progress email saved so it survives closing the
// composer. Step 2a covers NEW-email drafts (thread_id null, kind 'new'); the
// schema also carries scheduled_at / nylas_schedule_id for Step 2b (scheduled send)
// and thread_id/kind for future reply drafts.
//
// Reads use RLS (own drafts). Writes go through the service-role admin client; the
// ROUTE is responsible for the account-access gate before calling upsertDraft.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MailParticipant } from './types'

export type InboxDraft = {
  id: string
  company_id: string
  account_id: string
  created_by: string
  thread_id: string | null
  kind: string
  reply_to_message_id: string | null
  to_recipients: MailParticipant[]
  cc_recipients: MailParticipant[]
  bcc_recipients: MailParticipant[]
  subject: string | null
  body_html: string | null
  attachments: Array<{ id: string; filename?: string; contentType?: string; size?: number }>
  scheduled_at: string | null
  nylas_schedule_id: string | null
  status: string
  created_at: string
  updated_at: string
}

const DRAFT_COLS =
  'id, company_id, account_id, created_by, thread_id, kind, reply_to_message_id, to_recipients, cc_recipients, bcc_recipients, subject, body_html, attachments, scheduled_at, nylas_schedule_id, status, created_at, updated_at'

// List a user's editable drafts + still-pending scheduled sends (newest first).
// A scheduled send whose time has passed is assumed delivered (sync mirrors the
// real Sent message) and is excluded from the list.
export async function listMyDrafts(
  admin: SupabaseClient,
  userId: string,
  opts: { accountId?: string; nowIso: string }
): Promise<InboxDraft[]> {
  let q = admin
    .from('inbox_drafts')
    .select(DRAFT_COLS)
    .eq('created_by', userId)
    .in('status', ['draft', 'scheduled'])
    .order('updated_at', { ascending: false })
    .limit(200)
  if (opts.accountId) q = q.eq('account_id', opts.accountId)
  const { data } = await q
  const rows = (data ?? []) as InboxDraft[]
  // Drop scheduled sends whose fire time has passed (already delivered by the provider).
  return rows.filter((d) => !(d.status === 'scheduled' && d.scheduled_at && d.scheduled_at <= opts.nowIso))
}

// The caller's in-progress reply draft for a specific thread (if any). Used to
// resume a half-written reply when the thread is reopened.
export async function getMyThreadDraft(
  admin: SupabaseClient,
  threadId: string,
  userId: string
): Promise<InboxDraft | null> {
  const { data } = await admin
    .from('inbox_drafts')
    .select(DRAFT_COLS)
    .eq('thread_id', threadId)
    .eq('created_by', userId)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as InboxDraft) || null
}

export async function getMyDraft(
  admin: SupabaseClient,
  id: string,
  userId: string
): Promise<InboxDraft | null> {
  const { data } = await admin
    .from('inbox_drafts')
    .select(DRAFT_COLS)
    .eq('id', id)
    .eq('created_by', userId)
    .maybeSingle()
  return (data as InboxDraft) || null
}

export type UpsertDraftInput = {
  id?: string | null
  companyId: string
  accountId: string
  userId: string
  threadId?: string | null
  kind?: string
  replyToMessageId?: string | null
  to?: MailParticipant[]
  cc?: MailParticipant[]
  bcc?: MailParticipant[]
  subject?: string | null
  bodyHtml?: string | null
  attachments?: Array<{ id: string; filename?: string; contentType?: string; size?: number }>
}

// Create or update a draft. When `id` is given it updates only the caller's own
// row (created_by guard); otherwise it inserts. Returns the draft id.
export async function upsertDraft(admin: SupabaseClient, input: UpsertDraftInput): Promise<string | null> {
  const nowIso = new Date().toISOString()
  const fields = {
    company_id: input.companyId,
    account_id: input.accountId,
    created_by: input.userId,
    thread_id: input.threadId ?? null,
    kind: input.kind || 'new',
    reply_to_message_id: input.replyToMessageId ?? null,
    to_recipients: input.to ?? [],
    cc_recipients: input.cc ?? [],
    bcc_recipients: input.bcc ?? [],
    subject: input.subject ?? null,
    body_html: input.bodyHtml ?? null,
    attachments: input.attachments ?? [],
    status: 'draft',
    updated_at: nowIso,
  }

  if (input.id) {
    const { data, error } = await admin
      .from('inbox_drafts')
      .update(fields)
      .eq('id', input.id)
      .eq('created_by', input.userId) // never touch someone else's draft
      .select('id')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data?.id) return data.id as string
    // Row not found (deleted / not ours) → fall through to insert a fresh one.
  }

  const { data, error } = await admin
    .from('inbox_drafts')
    .insert(fields)
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return (data?.id as string) || null
}

// Delete the caller's own draft. Returns the deleted row (so a scheduled-send
// delete can cancel the provider schedule). Returns null if not found / not owned.
export async function deleteMyDraft(
  admin: SupabaseClient,
  id: string,
  userId: string
): Promise<InboxDraft | null> {
  const { data } = await admin
    .from('inbox_drafts')
    .delete()
    .eq('id', id)
    .eq('created_by', userId)
    .select(DRAFT_COLS)
    .maybeSingle()
  return (data as InboxDraft) || null
}
