import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendHubPush } from '@/lib/hub-push'

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
    .select('id, content, done, done_at, priority, due_date, assignee_id, created_by, forwarded_from_message_id, created_at, assignee:hub_users!assignee_id(id, display_name, avatar_url), creator:hub_users!created_by(id, display_name, avatar_url)')
    .eq('board_id', boardId)
    .order('created_at', { ascending: true })

  if (filter === 'open') {
    query = query.eq('done', false)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json({ items: [] })

  // Fetch comment and attachment counts for all items in two queries
  const itemIds = data.map((i: { id: string }) => i.id)
  const [{ data: commentRows }, { data: attachRows }] = await Promise.all([
    supabase.from('board_item_comments').select('board_item_id').in('board_item_id', itemIds),
    supabase.from('board_item_attachments').select('board_item_id').in('board_item_id', itemIds),
  ])

  const commentCounts: Record<string, number> = {}
  for (const r of commentRows ?? []) commentCounts[r.board_item_id] = (commentCounts[r.board_item_id] ?? 0) + 1
  const attachCounts: Record<string, number> = {}
  for (const r of attachRows ?? []) attachCounts[r.board_item_id] = (attachCounts[r.board_item_id] ?? 0) + 1

  const items = data.map((i: { id: string }) => ({
    ...i,
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

  const { content, priority, due_date, assignee_id, forwarded_from_message_id } = await request.json()
  if (!content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 })

  const { data: item, error } = await supabase
    .from('board_items')
    .insert({
      board_id: boardId,
      company_id: profile.company_id,
      content: content.trim(),
      priority: priority ?? 'none',
      due_date: due_date ?? null,
      assignee_id: assignee_id ?? null,
      forwarded_from_message_id: forwarded_from_message_id ?? null,
      created_by: user.id,
    })
    .select('id, content, done, done_at, priority, due_date, assignee_id, created_by, forwarded_from_message_id, created_at, assignee:hub_users!assignee_id(id, display_name, avatar_url), creator:hub_users!created_by(id, display_name, avatar_url)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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

  return NextResponse.json({ ...item, comment_count: 0, attachment_count: 0 }, { status: 201 })
}
