import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMyDraft, deleteMyDraft } from '@/lib/inbox/drafts'

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
  const deleted = await deleteMyDraft(admin, id, userId)
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
