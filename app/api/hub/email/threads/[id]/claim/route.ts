import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxThreadPermissions } from '@/lib/inbox/permissions'

export const dynamic = 'force-dynamic'

// POST /api/hub/email/threads/[id]/claim — claim an unassigned shared thread for
// yourself. Same seating as /assign with user_id = me, event 'claimed'.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const perms = await getInboxThreadPermissions(supabase, id, user.id)
  if (!perms.canClaim) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const { data: thread } = await admin
    .from('inbox_threads')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Take over as sole owner.
  await admin.from('inbox_thread_members').delete().eq('thread_id', id).eq('role', 'owner')
  await admin.from('inbox_thread_members').delete().eq('thread_id', id).eq('user_id', user.id)
  const { error: memberErr } = await admin.from('inbox_thread_members').insert({
    thread_id: id,
    user_id: user.id,
    role: 'owner',
    added_by: user.id,
  })
  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 })

  const { error: updErr } = await admin
    .from('inbox_threads')
    .update({ assigned_to_user_id: user.id, status: 'assigned', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  await admin.from('inbox_thread_events').insert({
    company_id: thread.company_id,
    thread_id: id,
    event_type: 'claimed',
    actor_user_id: user.id,
    target_user_id: user.id,
  })

  after(async () => {
    try {
      const ch = admin.channel('inbox:' + thread.company_id)
      await ch.subscribe()
      await ch.send({ type: 'broadcast', event: 'update', payload: { thread_id: id } })
      await admin.removeChannel(ch)
    } catch (err) {
      console.warn('[inbox:claim] broadcast failed', err)
    }
  })

  return NextResponse.json({ ok: true })
}
