import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMyDraft, deleteMyDraft } from '@/lib/inbox/drafts'
import { getInboxAccountById } from '@/lib/inbox/accounts'
import { getMailProvider } from '@/lib/inbox/provider'
import { r2Delete } from '@/lib/r2'

export const dynamic = 'force-dynamic'

// GET /api/hub/email/drafts/[id] — the caller's own draft (for reopening in the composer).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId, companyId } = auth
  const { id } = await params

  const admin = createAdminClient()
  const draft = await getMyDraft(admin, id, userId)
  if (!draft || draft.company_id !== companyId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ draft })
}

// DELETE /api/hub/email/drafts/[id] — discard the caller's own draft.
// (Step 2b will also cancel the provider schedule when the deleted row is a scheduled send.)
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId } = auth
  const { id } = await params

  const admin = createAdminClient()

  // Cancelling a scheduled send: cancel it at the provider FIRST (must be ≥10s before
  // its send time). If that fails, keep the row and tell the caller — it may be sending.
  const existing = await getMyDraft(admin, id, userId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status === 'scheduled' && existing.nylas_schedule_id) {
    const account = await getInboxAccountById(admin, existing.account_id)
    if (account) {
      try {
        await getMailProvider(account).cancelScheduledSend(existing.nylas_schedule_id)
      } catch (e) {
        console.warn('[inbox:drafts] cancel scheduled failed', e instanceof Error ? e.message : e)
        return NextResponse.json(
          { error: 'Could not cancel — it may already be sending.' },
          { status: 409 }
        )
      }
    }
  }

  const deleted = await deleteMyDraft(admin, id, userId)
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Best-effort: free any staged attachment objects in this company's R2 outbox.
  const prefix = `inbox/${existing.company_id}/outbox/`
  for (const a of deleted.attachments || []) {
    const key = a?.id
    if (typeof key === 'string' && key.startsWith(prefix)) {
      try {
        await r2Delete(key)
      } catch {
        /* best-effort */
      }
    }
  }

  return NextResponse.json({ ok: true })
}
