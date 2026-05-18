import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
  return NextResponse.json({ items: data ?? [] })
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
  return NextResponse.json(item, { status: 201 })
}
