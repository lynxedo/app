import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxThreadPermissions } from '@/lib/inbox/permissions'

export const dynamic = 'force-dynamic'

// The "who are we waiting on" values. Orthogonal to status (a thread can be assigned AND
// waiting) — deliberately NOT a status enum value, which is filtered in ~a dozen places.
const WAITING_STATES = ['customer', 'tech', 'vendor', 'approval'] as const
type WaitingState = (typeof WAITING_STATES)[number]

// POST /api/hub/email/threads/[id]/waiting — set or clear the thread's Waiting state.
//   body { waiting_state: 'customer'|'tech'|'vendor'|'approval' | null }
// null clears it. Anyone who can work the thread may set it (same gate as Close). The
// state auto-clears on the customer's next inbound reply — see mirrorThread in sync.ts.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const perms = await getInboxThreadPermissions(supabase, id, user.id)
  if (!perms.canClose) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as { waiting_state?: string | null } | null
  const raw = body?.waiting_state ?? null
  const waiting: WaitingState | null = raw === null ? null : (String(raw) as WaitingState)
  if (waiting !== null && !WAITING_STATES.includes(waiting)) {
    return NextResponse.json({ error: 'invalid waiting_state' }, { status: 400 })
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
      waiting_state: waiting,
      waiting_set_at: waiting ? nowIso : null,
      waiting_set_by: waiting ? user.id : null,
      updated_at: nowIso,
    })
    .eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  await admin.from('inbox_thread_events').insert({
    company_id: thread.company_id,
    thread_id: id,
    event_type: waiting ? 'waiting_set' : 'waiting_cleared',
    actor_user_id: user.id,
    detail: waiting ? { waiting_state: waiting } : {},
  })

  after(async () => {
    try {
      const ch = admin.channel('inbox:' + thread.company_id)
      await ch.subscribe()
      await ch.send({ type: 'broadcast', event: 'update', payload: { thread_id: id } })
      await admin.removeChannel(ch)
    } catch (err) {
      console.warn('[inbox:waiting] broadcast failed', err)
    }
  })

  return NextResponse.json({ ok: true, waiting_state: waiting })
}
