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

// Advance a 'YYYY-MM-DD' due date to its next occurrence. Anchored to the
// scheduled date (not "today") so the task keeps its cadence even when
// completed late. UTC math keeps the date from drifting across timezones.
function advanceDueDate(dueDate: string, recurrence: string): string {
  const d = new Date(dueDate + 'T00:00:00Z')
  switch (recurrence) {
    case 'daily': d.setUTCDate(d.getUTCDate() + 1); break
    case 'weekly': d.setUTCDate(d.getUTCDate() + 7); break
    case 'biweekly': d.setUTCDate(d.getUTCDate() + 14); break
    case 'monthly': d.setUTCMonth(d.getUTCMonth() + 1); break
    default: return dueDate
  }
  return d.toISOString().slice(0, 10)
}

function occurrenceLabel(dueDate: string): string {
  return new Date(dueDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
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

  // Recurring completion (hybrid): rather than marking the task done, log a
  // completion note onto it and roll it forward to its next occurrence. The
  // task's Notes thread becomes its completion history.
  if (body.done === true) {
    const { data: ctx } = await supabase
      .from('board_items')
      .select('recurrence, due_date, company_id')
      .eq('id', itemId)
      .single()
    if (ctx && ctx.recurrence && ctx.recurrence !== 'none' && ctx.due_date) {
      const { data: me } = await supabase.from('hub_users').select('display_name').eq('id', user.id).single()
      await supabase.from('board_item_comments').insert({
        board_item_id: itemId,
        company_id: ctx.company_id,
        content: `✅ Completed ${occurrenceLabel(ctx.due_date)} by ${me?.display_name ?? 'someone'}`,
        created_by: user.id,
      })
      const nextDue = advanceDueDate(ctx.due_date, ctx.recurrence)
      const { data: advanced, error: advErr } = await supabase
        .from('board_items')
        .update({ done: false, done_at: null, due_date: nextDue, overdue_notified_at: null })
        .eq('id', itemId)
        .select(ITEM_COLS)
        .single()
      if (advErr) return NextResponse.json({ error: advErr.message }, { status: 500 })
      const assignees = await fetchAssignees(supabase, itemId)
      return NextResponse.json({ ...advanced, assignees, recurred: true, next_due: nextDue })
    }
  }

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
