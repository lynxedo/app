import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { decideGaryEmail } from '@/lib/gary-email'

// An approver's decision on one of Gary's emails: approve (as written or edited)
// → re-checked and sent from the team mailbox; reject → never sent, and Gary
// won't write to that person again; test → the draft goes to the approver's OWN
// address (their sign-in email), never the customer's.

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminArea('ai')
  if (!auth.ok || !auth.company_id || !auth.user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const body = (await request.json().catch(() => null)) as {
    decision?: string
    subject?: unknown
    body?: unknown
    note?: unknown
  } | null
  if (!body || !['approve', 'reject', 'test'].includes(body.decision || '')) {
    return NextResponse.json({ error: 'decision must be approve, reject or test' }, { status: 400 })
  }
  const subject = typeof body.subject === 'string' ? body.subject : ''
  const text = typeof body.body === 'string' ? body.body : ''
  const result = await decideGaryEmail(
    createAdminClient(),
    auth.company_id,
    auth.user.id,
    id,
    body.decision === 'approve'
      ? { decision: 'approve', subject, body: text }
      : body.decision === 'test'
        ? { decision: 'test', subject, body: text, toEmail: auth.user.email || '' }
        : { decision: 'reject', note: typeof body.note === 'string' ? body.note : undefined },
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, message: result.message, item: result.item })
}
