import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type ItemRow = {
  id: string
  content: string
  done: boolean
  priority: string
  due_date: string | null
  due_time: string | null
  recurrence: string
  board_id: string
}

// Aggregated "My Tasks": open tasks the current user should act on, across the
// boards they can see (RLS-enforced) minus the boards they've hidden. A task
// counts if EITHER (a) the user is an assignee, OR (b) it lives on a board that
// is theirs alone — a private board where they are the only member (covers
// Personal boards and solo Private boards like "Ben's Board"), where every task
// is implicitly theirs and shouldn't need self-assigning.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: boards }, { data: hiddenRows }, { data: myAssign }] = await Promise.all([
    supabase.from('boards').select('id, name, is_private'),                   // RLS → only visible boards
    supabase.from('board_mytasks_hidden').select('board_id').eq('user_id', user.id),
    supabase.from('board_item_assignees').select('board_item_id').eq('user_id', user.id),
  ])

  const visible = (boards ?? []) as { id: string; name: string; is_private: boolean }[]
  const hiddenSet = new Set((hiddenRows ?? []).map((h: { board_id: string }) => h.board_id))
  const boardList = visible.map(b => ({ id: b.id, name: b.name, hidden: hiddenSet.has(b.id) }))
  const boardName: Record<string, string> = {}
  for (const b of visible) boardName[b.id] = b.name

  const includedBoardIds = visible.map(b => b.id).filter(id => !hiddenSet.has(id))
  if (includedBoardIds.length === 0) return NextResponse.json({ items: [], boards: boardList })

  // "Solo-mine" boards: private boards where I'm the only member. board_members
  // RLS hides other people's rows, so count via the admin client — scoped to the
  // boards I can already see, so this leaks nothing.
  const admin = createAdminClient()
  const { data: memberRows } = await admin
    .from('board_members')
    .select('board_id, user_id')
    .in('board_id', includedBoardIds)
  const memberCount: Record<string, number> = {}
  const iAmMember: Record<string, boolean> = {}
  for (const m of (memberRows ?? []) as { board_id: string; user_id: string }[]) {
    memberCount[m.board_id] = (memberCount[m.board_id] ?? 0) + 1
    if (m.user_id === user.id) iAmMember[m.board_id] = true
  }
  const soloMineIds = includedBoardIds.filter(id => {
    const b = visible.find(v => v.id === id)
    return b?.is_private && memberCount[id] === 1 && iAmMember[id]
  })

  const assignedIds = (myAssign ?? []).map((a: { board_item_id: string }) => a.board_item_id)
  const COLS = 'id, content, done, priority, due_date, due_time, recurrence, board_id'

  // Merge two sources, dedup by id: (A) every open task on a solo-mine board,
  // (B) open tasks assigned to me on any non-hidden board.
  const byId: Record<string, ItemRow> = {}
  if (soloMineIds.length > 0) {
    const { data } = await supabase.from('board_items').select(COLS).in('board_id', soloMineIds).eq('done', false)
    for (const it of (data ?? []) as ItemRow[]) byId[it.id] = it
  }
  if (assignedIds.length > 0) {
    const { data } = await supabase.from('board_items').select(COLS).in('id', assignedIds).eq('done', false).in('board_id', includedBoardIds)
    for (const it of (data ?? []) as ItemRow[]) byId[it.id] = it
  }

  const items = Object.values(byId)
    .map(it => ({ ...it, board_name: boardName[it.board_id] ?? 'Board' }))
    .sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0
      if (!a.due_date) return 1   // nulls last
      if (!b.due_date) return -1
      return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0
    })

  return NextResponse.json({ items, boards: boardList })
}
