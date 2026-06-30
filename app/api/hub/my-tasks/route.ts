import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Aggregated "My Tasks": every open task assigned to the current user, across
// the boards they can see (RLS-enforced) minus the boards they've hidden.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: boards }, { data: hiddenRows }, { data: myAssign }] = await Promise.all([
    supabase.from('boards').select('id, name'),                               // RLS → only visible boards
    supabase.from('board_mytasks_hidden').select('board_id').eq('user_id', user.id),
    supabase.from('board_item_assignees').select('board_item_id').eq('user_id', user.id),
  ])

  const hiddenSet = new Set((hiddenRows ?? []).map((h: { board_id: string }) => h.board_id))
  const boardList = (boards ?? []).map((b: { id: string; name: string }) => ({ id: b.id, name: b.name, hidden: hiddenSet.has(b.id) }))
  const boardName: Record<string, string> = {}
  for (const b of (boards ?? []) as { id: string; name: string }[]) boardName[b.id] = b.name

  const assignedIds = (myAssign ?? []).map((a: { board_item_id: string }) => a.board_item_id)
  const includedBoardIds = (boards ?? []).map((b: { id: string }) => b.id).filter(id => !hiddenSet.has(id))
  if (assignedIds.length === 0 || includedBoardIds.length === 0) {
    return NextResponse.json({ items: [], boards: boardList })
  }

  const { data: items, error } = await supabase
    .from('board_items')
    .select('id, content, done, priority, due_date, due_time, recurrence, board_id')
    .in('id', assignedIds)
    .eq('done', false)
    .in('board_id', includedBoardIds)
    .order('due_date', { ascending: true, nullsFirst: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = (items ?? []).map((it: { board_id: string }) => ({ ...it, board_name: boardName[it.board_id] ?? 'Board' }))
  return NextResponse.json({ items: result, boards: boardList })
}
