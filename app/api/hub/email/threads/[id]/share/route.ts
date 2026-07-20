import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxThreadPermissions } from '@/lib/inbox/permissions'
import { sendHubPush } from '@/lib/hub-push'

export const dynamic = 'force-dynamic'

// POST /api/hub/email/threads/[id]/share — body { user_id }
// Share this ONE thread with a technician (thread-scoped access, PRD Decision C).
// Full-access only (canShare).
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
  const targetUserId: string | null = body.user_id || null
  if (!targetUserId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  const perms = await getInboxThreadPermissions(supabase, id, user.id)
  if (!perms.canShare) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const { data: thread } = await admin
    .from('inbox_threads')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Only share within this thread's company (blocks a bogus membership row + cross-company push).
  const { data: target } = await admin
    .from('user_profiles')
    .select('company_id')
    .eq('id', targetUserId)
    .maybeSingle()
  if (!target || target.company_id !== thread.company_id) {
    return NextResponse.json({ error: 'Invalid user' }, { status: 400 })
  }

  const { error } = await admin.from('inbox_thread_members').insert({
    thread_id: id,
    user_id: targetUserId,
    role: 'member',
    added_by: user.id,
  })
  // Ignore duplicate PK (already shared); surface anything else.
  if (error && error.code !== '23505') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await admin.from('inbox_thread_events').insert({
    company_id: thread.company_id,
    thread_id: id,
    event_type: 'shared',
    actor_user_id: user.id,
    target_user_id: targetUserId,
  })

  // Notify the shared user only on a fresh add (never on a duplicate, never yourself).
  if (!error && targetUserId !== user.id) {
    after(async () => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
        await sendHubPush(
          [targetUserId],
          {
            title: '📧 Conversation shared with you',
            body: 'A teammate shared an email conversation with you.',
            url: `${baseUrl}/hub/email/${id}?source=push`,
            type: 'inbox',
            groupKey: id,
          },
          { isDm: true }
        )
      } catch (err) {
        console.warn('[inbox:share] push failed', err)
      }
    })
  }

  return NextResponse.json({ ok: true })
}

// DELETE /api/hub/email/threads/[id]/share — body { user_id } (or ?user_id=)
// Revoke a technician's thread-scoped access. Full-access only (canShare).
export async function DELETE(
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
  const url = new URL(request.url)
  const targetUserId: string | null = body.user_id || url.searchParams.get('user_id') || null
  if (!targetUserId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  const perms = await getInboxThreadPermissions(supabase, id, user.id)
  if (!perms.canShare) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const { data: thread } = await admin
    .from('inbox_threads')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Only revoke a shared 'member' seat — never drop the owner via this route.
  const { error } = await admin
    .from('inbox_thread_members')
    .delete()
    .eq('thread_id', id)
    .eq('user_id', targetUserId)
    .eq('role', 'member')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await admin.from('inbox_thread_events').insert({
    company_id: thread.company_id,
    thread_id: id,
    event_type: 'unshared',
    actor_user_id: user.id,
    target_user_id: targetUserId,
  })

  return NextResponse.json({ ok: true })
}
