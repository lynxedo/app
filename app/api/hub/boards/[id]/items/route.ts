import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendHubPush } from '@/lib/hub-push'

type SB = Awaited<ReturnType<typeof createClient>>

const ITEM_COLS =
  'id, content, done, done_at, priority, due_date, due_time, recurrence, created_by, forwarded_from_message_id, created_at, creator:hub_users!created_by(id, display_name, avatar_url)'

type AssigneeRow = {
  board_item_id: string
  user: { id: string; display_name: string; avatar_url: string | null } | null
}

// Map each item id → its assignee hub_users[]. Mirrors the comment/attachment
// count batching below — one query for the whole page of items.
async function fetchAssigneeMap(supabase: SB, itemIds: string[]) {
  const map: Record<string, { id: string; display_name: string; avatar_url: string | null }[]> = {}
  if (itemIds.length === 0) return map
  const { data } = await supabase
    .from('board_item_assignees')
    .select('board_item_id, user:hub_users!user_id(id, display_name, avatar_url)')
    .in('board_item_id', itemIds)
  for (const row of (data ?? []) as unknown as AssigneeRow[]) {
    if (!row.user) continue
    ;(map[row.board_item_id] ??= []).push(row.user)
  }
  return map
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: boardId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const filter = url.searchParams.get('filter') ?? 'open'

  let query = supabase
    .from('board_items')
    .select(ITEM_COLS)
    .eq('board_id', boardId)
    .order('created_at', { ascending: true })

  if (filter === 'open') {
    query = query.eq('done', false)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json({ items: [] })

  // Fetch comment counts, attachment counts, and assignees for all items
  const itemIds = data.map((i: { id: string }) => i.id)
  const [{ data: commentRows }, { data: attachRows }, assigneeMap] = await Promise.all([
    supabase.from('board_item_comments').select('board_item_id').in('board_item_id', itemIds),
    supabase.from('board_item_attachments').select('board_item_id').in('board_item_id', itemIds),
    fetchAssigneeMap(supabase, itemIds),
  ])

  const commentCounts: Record<string, number> = {}
  for (const r of commentRows ?? []) commentCounts[r.board_item_id] = (commentCounts[r.board_item_id] ?? 0) + 1
  const attachCounts: Record<string, number> = {}
  for (const r of attachRows ?? []) attachCounts[r.board_item_id] = (attachCounts[r.board_item_id] ?? 0) + 1

  const items = data.map((i: { id: string }) => ({
    ...i,
    assignees: assigneeMap[i.id] ?? [],
    comment_count: commentCounts[i.id] ?? 0,
    attachment_count: attachCounts[i.id] ?? 0,
  }))

  return NextResponse.json({ items })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: boardId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { content, priority, due_date, due_time, recurrence, assignee_ids, forwarded_from_message_id } = await request.json()
  if (!content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 })

  const { data: item, error } = await supabase
    .from('board_items')
    .insert({
      board_id: boardId,
      company_id: profile.company_id,
      content: content.trim(),
      priority: priority ?? 'none',
      due_date: due_date ?? null,
      due_time: due_time ?? null,
      recurrence: recurrence ?? 'none',
      forwarded_from_message_id: forwarded_from_message_id ?? null,
      created_by: user.id,
    })
    .select(ITEM_COLS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Multiple assignees
  const ids: string[] = Array.isArray(assignee_ids) ? assignee_ids.filter(Boolean) : []
  let assignees: { id: string; display_name: string; avatar_url: string | null }[] = []
  if (ids.length > 0) {
    await supabase.from('board_item_assignees').insert(ids.map(uid => ({ board_item_id: (item as { id: string }).id, user_id: uid })))
    const m = await fetchAssigneeMap(supabase, [(item as { id: string }).id])
    assignees = m[(item as { id: string }).id] ?? []
  }

  // Non-blocking: notify all board members (minus the creator) about the new task
  ;(async () => {
    try {
      const admin = createAdminClient()
      const [{ data: boardRow }, { data: senderRow }, { data: memberRows }] = await Promise.all([
        admin.from('boards').select('name, is_private, created_by').eq('id', boardId).single(),
        admin.from('hub_users').select('display_name').eq('id', user.id).single(),
        admin.from('board_members').select('user_id').eq('board_id', boardId),
      ])
      const recipientSet = new Set<string>()
      if (boardRow?.created_by && boardRow.created_by !== user.id) recipientSet.add(boardRow.created_by)
      for (const m of (memberRows ?? []) as { user_id: string }[]) {
        if (m.user_id !== user.id) recipientSet.add(m.user_id)
      }
      const recipientIds = [...recipientSet]
      if (recipientIds.length > 0) {
        const senderName = senderRow?.display_name ?? 'Someone'
        const boardName = boardRow?.name ?? 'a board'
        await sendHubPush(recipientIds, {
          title: `${senderName} added a task to ${boardName}`,
          body: content.trim().slice(0, 120),
          url: `/hub/board/${boardId}`,
        })
      }
    } catch (err) {
      console.error('[board items] new-item push failed:', (err as Error).message)
    }
  })()

  return NextResponse.json({ ...item, assignees, comment_count: 0, attachment_count: 0 }, { status: 201 })
}
