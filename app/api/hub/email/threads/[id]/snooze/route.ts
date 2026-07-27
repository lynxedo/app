import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxThreadPermissions } from '@/lib/inbox/permissions'

export const dynamic = 'force-dynamic'

// POST /api/hub/email/threads/[id]/snooze — hide the thread from the active queue
// until a chosen time (it resurfaces when snoozed_until passes; the list route
// filters on this). Orthogonal to status/waiting — a snoozed thread keeps its
// status. Anyone who can view the thread may snooze it.
//   body { snoozed_until: string | null }   // ISO timestamp; null un-snoozes.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const perms = await getInboxThreadPermissions(supabase, id, user.id)
  if (!perms.canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as { snoozed_until?: string | null } | null
  const raw = body?.snoozed_until ?? null

  // Normalize to a canonical ISO string; reject anything unparseable.
  let snoozedUntil: string | null = null
  if (raw !== null) {
    const ms = Date.parse(String(raw))
    if (Number.isNaN(ms)) {
      return NextResponse.json({ error: 'invalid snoozed_until' }, { status: 400 })
    }
    snoozedUntil = new Date(ms).toISOString()
  }

  const admin = createAdminClient()
  const { data: thread } = await admin
    .from('inbox_threads')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const nowIso = new Date().toISOString()
  const { error: updErr } = await admin
    .from('inbox_threads')
    .update({
      snoozed_until: snoozedUntil,
      snoozed_by: snoozedUntil ? user.id : null,
      updated_at: nowIso,
    })
    .eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  await admin.from('inbox_thread_events').insert({
    company_id: thread.company_id,
    thread_id: id,
    event_type: snoozedUntil ? 'snoozed' : 'unsnoozed',
    actor_user_id: user.id,
    detail: { snoozed_until: snoozedUntil },
  })

  after(async () => {
    try {
      const ch = admin.channel('inbox:' + thread.company_id)
      await ch.subscribe()
      await ch.send({ type: 'broadcast', event: 'update', payload: { thread_id: id } })
      await admin.removeChannel(ch)
    } catch (err) {
      console.warn('[inbox:snooze] broadcast failed', err)
    }
  })

  return NextResponse.json({ ok: true, snoozed_until: snoozedUntil })
}
