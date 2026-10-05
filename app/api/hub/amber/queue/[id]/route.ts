import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { decideAmberQueueItem } from '@/lib/hub-actions/amber-queue'

// Approve (optionally with an edited message) or reject one queue item.
//
// THIS is the human in the loop for Amber's own account: a person's own Hub
// session, an approver of this company. Amber has no session and cannot reach it.

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireAdminArea('ai')
  if (!auth.ok || !auth.company_id || !auth.user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { decision?: string; edits?: Record<string, unknown>; note?: string; seenPreview?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const decision =
    body.decision === 'approve'
      ? {
          decision: 'approve' as const,
          edits: body.edits && typeof body.edits === 'object' ? body.edits : undefined,
          // The card the approver was looking at — nothing runs unless it is current.
          seenPreview: typeof body.seenPreview === 'string' ? body.seenPreview : '',
        }
      : body.decision === 'reject'
        ? { decision: 'reject' as const, note: typeof body.note === 'string' ? body.note : undefined }
        : null
  if (!decision) return NextResponse.json({ error: 'decision must be approve or reject' }, { status: 400 })

  const res = await decideAmberQueueItem(createAdminClient(), auth.company_id, auth.user.id, id, decision)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ item: res.item })
}
