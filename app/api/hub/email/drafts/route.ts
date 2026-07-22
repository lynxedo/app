import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxUserFlags } from '@/lib/inbox/permissions'
import { getSharedAccount, getPersonalAccount, getInboxAccountById } from '@/lib/inbox/accounts'
import type { InboxAccount } from '@/lib/inbox/accounts'
import { listMyDrafts, upsertDraft } from '@/lib/inbox/drafts'
import { parseAttachmentMetas } from '@/lib/inbox/send'
import type { MailParticipant } from '@/lib/inbox/types'

export const dynamic = 'force-dynamic'

// Resolve + gate the mailbox a draft belongs to (same rules as POST /compose):
// shared needs compose access; personal must be the owner's own. Flags read via the
// admin client (like the accounts route) — service-role, no cookie-client typing dance.
async function resolveAccount(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  userId: string,
  accountParam: string
): Promise<{ account: InboxAccount } | { error: string; status: number }> {
  if (accountParam === 'shared') {
    const account = await getSharedAccount(admin, companyId)
    if (!account) return { error: 'No shared mailbox connected', status: 400 }
    const flags = await getInboxUserFlags(admin, userId)
    if (!flags.canCompose) return { error: 'Forbidden', status: 403 }
    return { account }
  }
  if (accountParam === 'personal') {
    const account = await getPersonalAccount(admin, companyId, userId)
    if (!account) return { error: 'No personal mailbox connected', status: 400 }
    return { account }
  }
  const byId = await getInboxAccountById(admin, accountParam)
  if (!byId || byId.company_id !== companyId) return { error: 'Mailbox not found', status: 404 }
  if (byId.account_type === 'shared') {
    const flags = await getInboxUserFlags(admin, userId)
    if (!flags.canCompose) return { error: 'Forbidden', status: 403 }
  } else if (byId.owner_user_id !== userId) {
    return { error: 'Forbidden', status: 403 }
  }
  return { account: byId }
}

// GET /api/hub/email/drafts?account=<shared|personal|id>  — the caller's own drafts
// (+ still-pending scheduled sends), optionally scoped to one mailbox.
export async function GET(request: Request) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId, companyId } = auth

  const accountParam = new URL(request.url).searchParams.get('account')
  const admin = createAdminClient()

  let accountId: string | undefined
  if (accountParam) {
    const res = await resolveAccount(admin, companyId, userId, accountParam)
    // A missing/forbidden mailbox just yields no drafts for it (not an error to the list view).
    if ('account' in res) accountId = res.account.id
    else return NextResponse.json({ drafts: [] })
  }

  const drafts = await listMyDrafts(admin, userId, { accountId, nowIso: new Date().toISOString() })
  return NextResponse.json({ drafts })
}

// POST /api/hub/email/drafts — create or update the caller's draft.
// Body: { id?, account, threadId?, kind?, replyToMessageId?, to?, cc?, bcc?, subject?, bodyHtml?, attachments? }
export async function POST(request: Request) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId, companyId } = auth

  const body = await request.json().catch(() => ({}))
  const accountParam: string = typeof body.account === 'string' ? body.account : 'shared'

  const admin = createAdminClient()
  const res = await resolveAccount(admin, companyId, userId, accountParam)
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: res.status })

  const to: MailParticipant[] = Array.isArray(body.to)
    ? body.to.filter((p: MailParticipant) => p && typeof p.email === 'string')
    : []
  const cc: MailParticipant[] = Array.isArray(body.cc)
    ? body.cc.filter((p: MailParticipant) => p && typeof p.email === 'string')
    : []
  const bcc: MailParticipant[] = Array.isArray(body.bcc)
    ? body.bcc.filter((p: MailParticipant) => p && typeof p.email === 'string')
    : []

  try {
    const id = await upsertDraft(admin, {
      id: typeof body.id === 'string' ? body.id : null,
      companyId,
      accountId: res.account.id,
      userId,
      threadId: typeof body.threadId === 'string' ? body.threadId : null,
      kind: typeof body.kind === 'string' ? body.kind : 'new',
      replyToMessageId: typeof body.replyToMessageId === 'string' ? body.replyToMessageId : null,
      to,
      cc,
      bcc,
      subject: typeof body.subject === 'string' ? body.subject : null,
      bodyHtml: typeof body.bodyHtml === 'string' ? body.bodyHtml : null,
      attachments: parseAttachmentMetas(body.attachments),
    })
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error }, { status: 500 })
  }
}
