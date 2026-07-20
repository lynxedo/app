import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxThreadPermissions } from '@/lib/inbox/permissions'
import { getInboxAccountById } from '@/lib/inbox/accounts'
import { sendInboxReply } from '@/lib/inbox/send'
import { sendHubPush } from '@/lib/hub-push'
import type { MailParticipant } from '@/lib/inbox/types'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const bodyHtml: string = typeof body.bodyHtml === 'string' ? body.bodyHtml.trim() : ''
  const cc: MailParticipant[] = Array.isArray(body.cc) ? body.cc : []
  const bcc: MailParticipant[] = Array.isArray(body.bcc) ? body.bcc : []
  if (!bodyHtml) return NextResponse.json({ error: 'Empty message' }, { status: 400 })

  const perms = await getInboxThreadPermissions(supabase, id, user.id)
  if (!perms.canReply) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  // Resolve the account behind this thread (admin — inbox_accounts is service-role).
  const { data: threadRow } = await admin
    .from('inbox_threads')
    .select('id, company_id, account_id, is_shared, assigned_to_user_id')
    .eq('id', id)
    .maybeSingle()
  if (!threadRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const account = await getInboxAccountById(admin, threadRow.account_id)
  if (!account) return NextResponse.json({ error: 'Mailbox not connected' }, { status: 400 })

  const result = await sendInboxReply(admin, {
    account,
    threadId: id,
    userId: user.id,
    bodyHtml,
    cc,
    bcc,
  })

  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 502 })

  const companyId = threadRow.company_id
  after(async () => {
    // Realtime nudge for anyone watching the shared inbox.
    try {
      const ch = admin.channel('inbox:' + companyId)
      await ch.subscribe()
      await ch.send({ type: 'broadcast', event: 'update', payload: { thread_id: id } })
      await admin.removeChannel(ch)
    } catch (err) {
      console.warn('[inbox:send] broadcast failed', err)
    }

    // Notify collaborators (assignee + members) other than the sender that a reply went out.
    if (threadRow.is_shared) {
      try {
        const ids = new Set<string>()
        if (threadRow.assigned_to_user_id) ids.add(threadRow.assigned_to_user_id)
        const { data: members } = await admin
          .from('inbox_thread_members')
          .select('user_id')
          .eq('thread_id', id)
        for (const m of (members ?? []) as { user_id: string }[]) ids.add(m.user_id)
        ids.delete(user.id)
        const recipients = Array.from(ids)
        if (recipients.length > 0) {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
          await sendHubPush(
            recipients,
            {
              title: '📧 Reply sent',
              body: 'A reply was sent on a shared inbox thread you follow.',
              url: `${baseUrl}/hub/email/${id}?source=push`,
              type: 'inbox',
              groupKey: id,
            },
            { isDm: true }
          )
        }
      } catch (err) {
        console.warn('[inbox:send] push fan-out failed', err)
      }
    }
  })

  return NextResponse.json({ ok: true, messageId: result.messageId })
}
