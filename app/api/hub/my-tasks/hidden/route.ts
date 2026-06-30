import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Toggle whether a board's tasks appear in the current user's My Tasks view.
// Per-user (RLS scopes board_mytasks_hidden rows to auth.uid()).
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { board_id, hidden } = await request.json()
  if (!board_id) return NextResponse.json({ error: 'board_id required' }, { status: 400 })

  if (hidden) {
    const { error } = await supabase
      .from('board_mytasks_hidden')
      .upsert({ user_id: user.id, board_id }, { ignoreDuplicates: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabase
      .from('board_mytasks_hidden')
      .delete()
      .eq('user_id', user.id)
      .eq('board_id', board_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
