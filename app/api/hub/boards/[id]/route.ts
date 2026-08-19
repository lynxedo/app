import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: board } = await admin.from('boards').select('created_by').eq('id', id).single()
  if (!board) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (board.created_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const updates: Record<string, unknown> = {}
  if (body.name !== undefined) updates.name = String(body.name).trim()
  if (body.is_private !== undefined) updates.is_private = body.is_private
  if (body.is_personal !== undefined) updates.is_personal = body.is_personal

  const { data: updated, error } = await admin
    .from('boards')
    .update(updates)
    .eq('id', id)
    .select('id, name, is_private, is_personal, created_by, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(updated)
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: board } = await admin.from('boards').select('created_by').eq('id', id).single()
  if (!board) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (board.created_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Child rows are cleaned up by the database, not here. Every FK down the chain
  // is ON DELETE CASCADE: boards -> board_items + board_members, and
  // board_items -> board_item_comments + board_item_attachments +
  // board_item_assignees. Deleting a single item (items/[itemId] DELETE) already
  // relies on exactly this. Don't hand-roll the deletes again - the version that
  // was here covered one of the five child tables and named a column that
  // doesn't exist, so it errored on every call and the cascade did the work
  // regardless.
  const { error } = await admin.from('boards').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
