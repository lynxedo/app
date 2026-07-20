import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxThreadPermissions } from '@/lib/inbox/permissions'

export const dynamic = 'force-dynamic'

// POST /api/hub/email/threads/[id]/notes — body { body }
// Leave an internal team note (never sent to the customer). Full-access only (canNote).
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
  const text: string = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) return NextResponse.json({ error: 'Empty note' }, { status: 400 })

  const perms = await getInboxThreadPermissions(supabase, id, user.id)
  if (!perms.canNote) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const { data: thread } = await admin
    .from('inbox_threads')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: note, error } = await admin
    .from('inbox_notes')
    .insert({
      company_id: thread.company_id,
      thread_id: id,
      body: text,
      created_by: user.id,
    })
    .select('id, body, created_by, created_at')
    .single()
  if (error || !note) {
    return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 })
  }

  await admin.from('inbox_thread_events').insert({
    company_id: thread.company_id,
    thread_id: id,
    event_type: 'note',
    actor_user_id: user.id,
  })

  return NextResponse.json({ ok: true, note })
}
