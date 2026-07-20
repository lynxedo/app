import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxThreadPermissions } from '@/lib/inbox/permissions'
import { sendHubPush } from '@/lib/hub-push'

export const dynamic = 'force-dynamic'

// POST /api/hub/email/threads/[id]/assign  — body { user_id: string|null }
// Assign to others requires full access (canAssign); a self-claim requires
// canClaim. Passing null unassigns (managers only).
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
  const targetUserId: string | null = body.user_id === null ? null : body.user_id || null

  const perms = await getInboxThreadPermissions(supabase, id, user.id)
  const isSelfClaim = targetUserId === user.id && perms.canClaim
  if (!perms.canAssign && !isSelfClaim) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()

  const { data: thread } = await admin
    .from('inbox_threads')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Never seat/assign/notify a user outside this thread's company (RLS would block their read
  // anyway, but this stops a bogus membership row, a cross-company push, and name disclosure).
  if (targetUserId) {
    const { data: target } = await admin
      .from('user_profiles')
      .select('company_id')
      .eq('id', targetUserId)
      .maybeSingle()
    if (!target || target.company_id !== thread.company_id) {
      return NextResponse.json({ error: 'Invalid user' }, { status: 400 })
    }
  }

  // Owner is single-seat: drop the prior owner row, then seat the new owner.
  await admin.from('inbox_thread_members').delete().eq('thread_id', id).eq('role', 'owner')

  if (targetUserId) {
    // Clear any existing (member) row for the target so promoting to owner can't hit a PK clash.
    await admin.from('inbox_thread_members').delete().eq('thread_id', id).eq('user_id', targetUserId)
    const { error: memberErr } = await admin.from('inbox_thread_members').insert({
      thread_id: id,
      user_id: targetUserId,
      role: 'owner',
      added_by: user.id,
    })
    if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 })
  }

  const { error: updErr } = await admin
    .from('inbox_threads')
    .update({
      assigned_to_user_id: targetUserId,
      status: targetUserId ? 'assigned' : 'open',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  const selfClaim = targetUserId === user.id
  await admin.from('inbox_thread_events').insert({
    company_id: thread.company_id,
    thread_id: id,
    event_type: selfClaim ? 'claimed' : 'assigned',
    actor_user_id: user.id,
    target_user_id: targetUserId,
  })

  after(async () => {
    try {
      const ch = admin.channel('inbox:' + thread.company_id)
      await ch.subscribe()
      await ch.send({ type: 'broadcast', event: 'update', payload: { thread_id: id } })
      await admin.removeChannel(ch)
    } catch (err) {
      console.warn('[inbox:assign] broadcast failed', err)
    }
    // Ping the assignee (unless they assigned it to themselves).
    if (targetUserId && !selfClaim) {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.lynxedo.com'
        await sendHubPush(
          [targetUserId],
          {
            title: '📧 Assigned to you',
            body: 'A shared inbox conversation was assigned to you.',
            url: `${baseUrl}/hub/email/${id}?source=push`,
            type: 'inbox',
            groupKey: id,
          },
          { isDm: true }
        )
      } catch (err) {
        console.warn('[inbox:assign] push failed', err)
      }
    }
  })

  return NextResponse.json({ ok: true })
}
