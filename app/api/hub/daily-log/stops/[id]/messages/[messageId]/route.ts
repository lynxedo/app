import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { workOrderAccess } from '@/lib/work-order-access'

// PATCH  /api/hub/daily-log/stops/:id/messages/:messageId  { content }  — edit a note
// DELETE /api/hub/daily-log/stops/:id/messages/:messageId               — delete a note
//
// Ben, Oct 2 2026: a tech must be able to fix or take back a note on a work order.
// The author may edit or delete their own note; a Work Orders admin
// (workOrderAccess().isAdmin) may do either on anyone's. A delete is SOFT (deleted_at) —
// the note leaves the thread but the row stays. Company scope is checked here
// (message → company, and the message must belong to this stop).

async function resolve(stopId: string, messageId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_admin_daily_log, can_access_daily_log_v2')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return { error: 'Profile not found', status: 404 as const }
  // Work Orders only (lib/work-order-access.ts) — was: anyone in the company.
  if (!workOrderAccess(profile).canAccess) return { error: 'Forbidden', status: 403 as const }

  const admin = createAdminClient()
  const { data: msg } = await admin
    .from('daily_log_stop_messages')
    .select('id, stop_id, company_id, user_id, deleted_at')
    .eq('id', messageId)
    .maybeSingle()
  if (!msg || msg.stop_id !== stopId || msg.company_id !== profile.company_id || msg.deleted_at) {
    return { error: 'Not found', status: 404 as const }
  }
  const { isAdmin } = workOrderAccess(profile)
  if (msg.user_id !== user.id && !isAdmin) {
    return { error: 'Only the person who wrote this note (or an admin) can change it', status: 403 as const }
  }
  return { admin, userId: user.id }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const { id: stopId, messageId } = await params
  const r = await resolve(stopId, messageId)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })

  const body = (await request.json().catch(() => ({}))) as { content?: unknown }
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content || content.length > 5000) {
    return NextResponse.json({ error: 'content must be 1–5000 characters' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const { data, error } = await r.admin
    .from('daily_log_stop_messages')
    .update({ content, edited_at: now, updated_at: now })
    .eq('id', messageId)
    .select('id, content, created_at, edited_at, user:hub_users!user_id(id, display_name, avatar_url), reactions:daily_log_stop_message_reactions(user_id, emoji)')
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  return NextResponse.json({ message: data })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const { id: stopId, messageId } = await params
  const r = await resolve(stopId, messageId)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })

  const now = new Date().toISOString()
  const { error } = await r.admin
    .from('daily_log_stop_messages')
    .update({ deleted_at: now, deleted_by: r.userId, updated_at: now })
    .eq('id', messageId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
