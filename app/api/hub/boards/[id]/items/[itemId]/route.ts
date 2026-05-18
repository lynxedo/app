import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
  if ('due_date' in body) update.due_date = body.due_date
  if ('assignee_id' in body) update.assignee_id = body.assignee_id
  if ('content' in body) update.content = body.content

  const { data: item, error } = await supabase
    .from('board_items')
    .update(update)
    .eq('id', itemId)
    .select('id, content, done, done_at, priority, due_date, assignee_id, created_by, created_at, assignee:hub_users!assignee_id(id, display_name, avatar_url), creator:hub_users!created_by(id, display_name, avatar_url)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(item)
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
