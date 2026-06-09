import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Toggle an emoji reaction on a Daily Log update — mirrors the message
// reactions route (/api/hub/reactions). RLS on daily_log_update_reactions
// enforces company scoping (insert/select) and own-user ownership (delete).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ updateId: string }> },
) {
  const { updateId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { emoji } = await request.json()
  if (!emoji) return NextResponse.json({ error: 'emoji required' }, { status: 400 })

  const { data: existing } = await supabase
    .from('daily_log_update_reactions')
    .select('update_id')
    .eq('update_id', updateId)
    .eq('user_id', user.id)
    .eq('emoji', emoji)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('daily_log_update_reactions')
      .delete()
      .eq('update_id', updateId)
      .eq('user_id', user.id)
      .eq('emoji', emoji)
    return NextResponse.json({ action: 'removed' })
  }

  await supabase
    .from('daily_log_update_reactions')
    .insert({ update_id: updateId, user_id: user.id, emoji })
  return NextResponse.json({ action: 'added' })
}
