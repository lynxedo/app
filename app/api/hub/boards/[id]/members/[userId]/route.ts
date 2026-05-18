import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: board } = await admin.from('boards').select('created_by').eq('id', id).single()
  if (!board) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (board.created_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Can't remove yourself (the creator)
  if (userId === user.id) return NextResponse.json({ error: 'Cannot remove board owner' }, { status: 400 })

  const { error } = await admin
    .from('board_members')
    .delete()
    .eq('board_id', id)
    .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
