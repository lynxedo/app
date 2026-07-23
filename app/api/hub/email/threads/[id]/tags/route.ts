import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxThreadPermissions } from '@/lib/inbox/permissions'
import { broadcastInboxUpdate } from '@/lib/inbox/sync'

export const dynamic = 'force-dynamic'

// Apply / remove a tag on ONE thread. Anyone who can VIEW the thread may tag it —
// a technician on a shared thread should be able to file it, so this deliberately
// does NOT require manager access (unlike managing the tag catalog itself).
// inbox_threads.tags is a denormalized uuid[]; we read-modify-write it deduped and
// audit each change in inbox_thread_events.

// Resolve the session user, gate on canView, and load the target thread. Returns
// either an error response or the pieces the handlers need.
async function loadThreadForTagging(id: string): Promise<
  | { error: NextResponse }
  | {
      userId: string
      admin: ReturnType<typeof createAdminClient>
      thread: { id: string; company_id: string; tags: string[] }
    }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const perms = await getInboxThreadPermissions(supabase, id, user.id)
  if (!perms.canView) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const admin = createAdminClient()
  const { data: thread } = await admin
    .from('inbox_threads')
    .select('id, company_id, tags')
    .eq('id', id)
    .maybeSingle()
  if (!thread) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }

  return {
    userId: user.id,
    admin,
    thread: {
      id: thread.id as string,
      company_id: thread.company_id as string,
      tags: ((thread.tags as string[] | null) ?? []),
    },
  }
}

function readTagId(body: unknown, url: URL): string {
  const fromBody =
    body && typeof body === 'object' && typeof (body as { tagId?: unknown }).tagId === 'string'
      ? (body as { tagId: string }).tagId
      : ''
  return (fromBody || url.searchParams.get('tagId') || '').trim()
}

// POST /api/hub/email/threads/[id]/tags — add a tag (body: { tagId }).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const loaded = await loadThreadForTagging(id)
  if ('error' in loaded) return loaded.error
  const { userId, admin, thread } = loaded

  const body = await request.json().catch(() => null)
  const tagId = readTagId(body, new URL(request.url))
  if (!tagId) return NextResponse.json({ error: 'tagId is required' }, { status: 400 })

  // The tag must exist, belong to this thread's company, and be active.
  const { data: tag } = await admin
    .from('inbox_tags')
    .select('id, company_id, active')
    .eq('id', tagId)
    .maybeSingle()
  if (!tag || tag.company_id !== thread.company_id || tag.active !== true) {
    return NextResponse.json({ error: 'Invalid tag' }, { status: 400 })
  }

  // Already applied → idempotent no-op (no duplicate array entry, no audit noise).
  if (thread.tags.includes(tagId)) return NextResponse.json({ ok: true, tags: thread.tags })

  const nextTags = [...thread.tags, tagId]
  // TODO(Decision J): mirror tag → Outlook category once Nylas Microsoft-category support is verified.
  const { error: updErr } = await admin
    .from('inbox_threads')
    .update({ tags: nextTags, updated_at: new Date().toISOString() })
    .eq('id', thread.id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  await admin.from('inbox_thread_events').insert({
    company_id: thread.company_id,
    thread_id: thread.id,
    event_type: 'tag_added',
    actor_user_id: userId,
    detail: { tag_id: tagId },
  })

  after(async () => {
    try {
      await broadcastInboxUpdate(admin, thread.company_id, thread.id)
    } catch (err) {
      console.warn('[inbox:tags] broadcast failed', err)
    }
  })

  return NextResponse.json({ ok: true, tags: nextTags })
}

// DELETE /api/hub/email/threads/[id]/tags — remove a tag (body { tagId } or ?tagId=).
// An inactive/deleted tag can still be removed from a thread, so we don't re-verify
// the tag definition here — just drop the id from the array.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const loaded = await loadThreadForTagging(id)
  if ('error' in loaded) return loaded.error
  const { userId, admin, thread } = loaded

  const body = await request.json().catch(() => null)
  const tagId = readTagId(body, new URL(request.url))
  if (!tagId) return NextResponse.json({ error: 'tagId is required' }, { status: 400 })

  // Not present → idempotent no-op.
  if (!thread.tags.includes(tagId)) return NextResponse.json({ ok: true, tags: thread.tags })

  const nextTags = thread.tags.filter((t) => t !== tagId)
  // TODO(Decision J): mirror tag → Outlook category once Nylas Microsoft-category support is verified.
  const { error: updErr } = await admin
    .from('inbox_threads')
    .update({ tags: nextTags, updated_at: new Date().toISOString() })
    .eq('id', thread.id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  await admin.from('inbox_thread_events').insert({
    company_id: thread.company_id,
    thread_id: thread.id,
    event_type: 'tag_removed',
    actor_user_id: userId,
    detail: { tag_id: tagId },
  })

  after(async () => {
    try {
      await broadcastInboxUpdate(admin, thread.company_id, thread.id)
    } catch (err) {
      console.warn('[inbox:tags] broadcast failed', err)
    }
  })

  return NextResponse.json({ ok: true, tags: nextTags })
}
