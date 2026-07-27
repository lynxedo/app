import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxThreadPermissions } from '@/lib/inbox/permissions'

export const dynamic = 'force-dynamic'

// POST /api/hub/email/threads/[id]/follow-up — set (or clear) a follow-up reminder
// on the thread. The followup-check cron DMs follow_up_by when follow_up_at passes.
//   body { follow_up_at: string | null, follow_up_note?: string | null, follow_up_by?: string | null }
// follow_up_at === null clears the whole reminder. Setting/editing resets
// follow_up_notified_at so a re-scheduled reminder can fire again. Anyone who can
// view the thread may set it; follow_up_by defaults to the setter.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const perms = await getInboxThreadPermissions(supabase, id, user.id)
  if (!perms.canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as {
    follow_up_at?: string | null
    follow_up_note?: string | null
    follow_up_by?: string | null
  } | null
  const rawAt = body?.follow_up_at ?? null

  const admin = createAdminClient()
  const { data: thread } = await admin
    .from('inbox_threads')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const nowIso = new Date().toISOString()

  // Clearing — null out all four follow-up columns.
  if (rawAt === null) {
    const { error: updErr } = await admin
      .from('inbox_threads')
      .update({
        follow_up_at: null,
        follow_up_by: null,
        follow_up_note: null,
        follow_up_notified_at: null,
        updated_at: nowIso,
      })
      .eq('id', id)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    await admin.from('inbox_thread_events').insert({
      company_id: thread.company_id,
      thread_id: id,
      event_type: 'follow_up_cleared',
      actor_user_id: user.id,
      detail: { follow_up_at: null, follow_up_by: null },
    })

    after(async () => {
      try {
        const ch = admin.channel('inbox:' + thread.company_id)
        await ch.subscribe()
        await ch.send({ type: 'broadcast', event: 'update', payload: { thread_id: id } })
        await admin.removeChannel(ch)
      } catch (err) {
        console.warn('[inbox:follow-up] broadcast failed', err)
      }
    })

    return NextResponse.json({ ok: true })
  }

  // Setting/editing — validate the timestamp and resolve the assignee.
  const ms = Date.parse(String(rawAt))
  if (Number.isNaN(ms)) {
    return NextResponse.json({ error: 'invalid follow_up_at' }, { status: 400 })
  }
  const followUpAt = new Date(ms).toISOString()

  const note = typeof body?.follow_up_note === 'string' ? body.follow_up_note.trim() || null : null

  // Default the reminder owner to the setter. If an explicit target was passed,
  // it must belong to the same company as the thread (no cross-tenant reminders).
  let followUpBy = user.id
  const requestedBy = body?.follow_up_by ?? null
  if (requestedBy && requestedBy !== user.id) {
    const { data: target } = await admin
      .from('user_profiles')
      .select('id, company_id')
      .eq('id', requestedBy)
      .maybeSingle()
    if (!target || target.company_id !== thread.company_id) {
      return NextResponse.json({ error: 'follow_up_by must be in the thread company' }, { status: 400 })
    }
    followUpBy = requestedBy
  }

  const { error: updErr } = await admin
    .from('inbox_threads')
    .update({
      follow_up_at: followUpAt,
      follow_up_by: followUpBy,
      follow_up_note: note,
      follow_up_notified_at: null, // re-arm — a new/edited reminder must be able to fire again
      updated_at: nowIso,
    })
    .eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  await admin.from('inbox_thread_events').insert({
    company_id: thread.company_id,
    thread_id: id,
    event_type: 'follow_up_set',
    actor_user_id: user.id,
    target_user_id: followUpBy,
    detail: { follow_up_at: followUpAt, follow_up_by: followUpBy },
  })

  after(async () => {
    try {
      const ch = admin.channel('inbox:' + thread.company_id)
      await ch.subscribe()
      await ch.send({ type: 'broadcast', event: 'update', payload: { thread_id: id } })
      await admin.removeChannel(ch)
    } catch (err) {
      console.warn('[inbox:follow-up] broadcast failed', err)
    }
  })

  return NextResponse.json({ ok: true })
}
