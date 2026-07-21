import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCompany } from '@/lib/company-auth'
import { getInboxUserFlags } from '@/lib/inbox/permissions'
import { getSharedAccount, getPersonalAccount, getInboxAccountById } from '@/lib/inbox/accounts'
import { sendInboxNew, parseAttachmentMetas } from '@/lib/inbox/send'
import type { MailParticipant } from '@/lib/inbox/types'

export const dynamic = 'force-dynamic'
// Attachment sends fetch bytes from R2 + push them to Nylas as multipart — allow beyond the default budget.
export const maxDuration = 180

// POST /api/hub/email/compose — start a NEW outbound email.
// Body: {
//   account?: 'shared' | 'personal' | <accountId>,
//   to: [{ name?, email }], cc?: [...], bcc?: [...],
//   subject?: string,
//   bodyHtml?: string,                       // rich HTML (composer already embedded the signature)
//   body?: string,                           // legacy plain body (server appends the signature)
//   attachments?: [{ id, filename, contentType, size }],  // from POST /api/hub/email/attachments
// }
export async function POST(request: Request) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId, companyId, supabase } = auth

  const body = await request.json().catch(() => ({}))
  const accountParam: string = typeof body.account === 'string' ? body.account : 'shared'
  const to: MailParticipant[] = Array.isArray(body.to)
    ? body.to.filter((p: MailParticipant) => p && typeof p.email === 'string' && p.email)
    : []
  const cc: MailParticipant[] = Array.isArray(body.cc) ? body.cc : []
  const bcc: MailParticipant[] = Array.isArray(body.bcc) ? body.bcc : []
  const subject: string = typeof body.subject === 'string' ? body.subject : ''
  const bodyHtml: string = typeof body.bodyHtml === 'string' ? body.bodyHtml.trim() : ''
  const bodyText: string = typeof body.body === 'string' ? body.body.trim() : ''
  const attachments = parseAttachmentMetas(body.attachments)

  if (to.length === 0) return NextResponse.json({ error: 'At least one recipient is required' }, { status: 400 })
  if (!bodyHtml && !bodyText) return NextResponse.json({ error: 'Empty message' }, { status: 400 })

  const admin = createAdminClient()

  // Resolve the mailbox to send from + gate.
  let account
  if (accountParam === 'shared') {
    account = await getSharedAccount(admin, companyId)
    if (!account) return NextResponse.json({ error: 'No shared mailbox connected' }, { status: 400 })
    const flags = await getInboxUserFlags(supabase, userId)
    if (!flags.canCompose) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } else if (accountParam === 'personal') {
    account = await getPersonalAccount(admin, companyId, userId)
    if (!account) return NextResponse.json({ error: 'No personal mailbox connected' }, { status: 400 })
    // getPersonalAccount already scopes to owner_user_id === userId.
  } else {
    const byId = await getInboxAccountById(admin, accountParam)
    if (!byId || byId.company_id !== companyId) {
      return NextResponse.json({ error: 'Mailbox not found' }, { status: 404 })
    }
    account = byId
    if (account.account_type === 'shared') {
      const flags = await getInboxUserFlags(supabase, userId)
      if (!flags.canCompose) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    } else if (account.owner_user_id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const result = await sendInboxNew(admin, {
    account,
    userId,
    to,
    cc,
    bcc,
    subject,
    bodyHtml,
    bodyText,
    attachments,
  })

  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status || 502 })
  return NextResponse.json({ ok: true, messageId: result.messageId, threadId: result.threadId ?? null })
}
