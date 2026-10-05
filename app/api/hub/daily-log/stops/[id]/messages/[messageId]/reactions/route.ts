import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { workOrderAccess } from '@/lib/work-order-access'

// POST /api/hub/daily-log/stops/:id/messages/:messageId/reactions  { emoji }
//
// Toggle the caller's emoji reaction on one note of a work order (Daily Log v2
// stop message). Mirrors Daily Log v1's update reactions. Company scope is
// verified here (stop → entry → company) and only the caller's own row is ever
// written; the table's RLS covers reads. Returns the message's full reaction
// list so the client can replace its copy rather than guess.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const { id: stopId, messageId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('user_profiles').select('company_id, role, can_admin_daily_log, can_access_daily_log_v2').eq('id', user.id).single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  // Work Orders only (lib/work-order-access.ts) — was: anyone in the company.
  if (!workOrderAccess(profile).canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => ({}))) as { emoji?: unknown }
  const emoji = typeof body.emoji === 'string' ? body.emoji.trim() : ''
  // One emoji (allow a ZWJ/variation sequence), nothing else.
  if (!emoji || emoji.length > 16 || /\s/.test(emoji)) {
    return NextResponse.json({ error: 'emoji required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: msg } = await admin
    .from('daily_log_stop_messages')
    .select('id, stop_id, company_id')
    .eq('id', messageId)
    .maybeSingle()
  if (!msg || msg.stop_id !== stopId || msg.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: existing } = await admin
    .from('daily_log_stop_message_reactions')
    .select('message_id')
    .eq('message_id', messageId).eq('user_id', user.id).eq('emoji', emoji)
    .maybeSingle()

  let action: 'added' | 'removed'
  if (existing) {
    const { error } = await admin
      .from('daily_log_stop_message_reactions')
      .delete()
      .eq('message_id', messageId).eq('user_id', user.id).eq('emoji', emoji)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    action = 'removed'
  } else {
    const { error } = await admin
      .from('daily_log_stop_message_reactions')
      .insert({ message_id: messageId, user_id: user.id, emoji })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    action = 'added'
  }

  const { data: reactions } = await admin
    .from('daily_log_stop_message_reactions')
    .select('user_id, emoji')
    .eq('message_id', messageId)
  return NextResponse.json({ action, reactions: reactions ?? [] })
}
