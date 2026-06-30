import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type SB = Awaited<ReturnType<typeof createClient>>

const ITEM_COLS =
  'id, content, done, done_at, priority, due_date, due_time, recurrence, created_by, created_at, creator:hub_users!created_by(id, display_name, avatar_url)'

type AssigneeRow = { user: { id: string; display_name: string; avatar_url: string | null } | null }

async function fetchAssignees(supabase: SB, itemId: string) {
  const { data } = await supabase
    .from('board_item_assignees')
    .select('user:hub_users!user_id(id, display_name, avatar_url)')
    .eq('board_item_id', itemId)
  return ((data ?? []) as unknown as AssigneeRow[])
    .map(r => r.user)
    .filter(Boolean)
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { itemId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const update: Record<string, unknown> = {}

  if ('done' in body) {
    update.done = body.done
    update.done_at = body.done ? new Date().toISOString() : null
  }
  if ('priority' in body) update.priority = body.priority
  // Changing the due date/time re-arms the "overdue" notifier so Guardian can
  // alert again for the new deadline (it only DMs once per deadline).
  if ('due_date' in body) { update.due_date = body.due_date; update.overdue_notified_at = null }
  if ('due_time' in body) { update.due_time = body.due_time; update.overdue_notified_at = null }
  if ('recurrence' in body) update.recurrence = body.recurrence
  if ('content' in body) update.content = body.content

  // Replace the full assignee set when assignee_ids is provided
  if (Array.isArray(body.assignee_ids)) {
    await supabase.from('board_item_assignees').delete().eq('board_item_id', itemId)
    const ids: string[] = body.assignee_ids.filter(Boolean)
    if (ids.length > 0) {
      await supabase.from('board_item_assignees').insert(ids.map((uid: string) => ({ board_item_id: itemId, user_id: uid })))
    }
  }

  let item
  if (Object.keys(update).length > 0) {
    const { data, error } = await supabase
      .from('board_items')
      .update(update)
      .eq('id', itemId)
      .select(ITEM_COLS)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    item = data
  } else {
    const { data, error } = await supabase
      .from('board_items')
      .select(ITEM_COLS)
      .eq('id', itemId)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    item = data
  }

  const assignees = await fetchAssignees(supabase, itemId)
  return NextResponse.json({ ...item, assignees })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { itemId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('board_items').delete().eq('id', itemId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
