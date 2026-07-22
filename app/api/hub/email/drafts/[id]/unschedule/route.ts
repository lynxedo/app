import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMyDraft, revertScheduledToDraft } from '@/lib/inbox/drafts'
import { getInboxAccountById } from '@/lib/inbox/accounts'
import { getMailProvider } from '@/lib/inbox/provider'

export const dynamic = 'force-dynamic'

// POST /api/hub/email/drafts/[id]/unschedule — cancel a scheduled send and reopen it
// as an editable draft. Returns { draft: { id, kind, thread_id } } so the client can
// navigate into the right composer. 409 if it's too close to its send time to cancel.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId, companyId } = auth
  const { id } = await params

  const admin = createAdminClient()
  const draft = await getMyDraft(admin, id, userId)
  if (!draft || draft.company_id !== companyId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (draft.status !== 'scheduled') {
    return NextResponse.json({ error: 'Not a scheduled send' }, { status: 400 })
  }

  if (draft.nylas_schedule_id) {
    const account = await getInboxAccountById(admin, draft.account_id)
    if (account) {
      try {
        await getMailProvider(account).cancelScheduledSend(draft.nylas_schedule_id)
      } catch (e) {
        console.warn('[inbox:drafts] unschedule cancel failed', e instanceof Error ? e.message : e)
        return NextResponse.json({ error: 'Could not edit — it may already be sending.' }, { status: 409 })
      }
    }
  }

  const reverted = await revertScheduledToDraft(admin, id, userId)
  if (!reverted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    ok: true,
    draft: { id: reverted.id, kind: reverted.kind, thread_id: reverted.thread_id },
  })
}
