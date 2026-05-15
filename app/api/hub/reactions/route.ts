import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { message_id, emoji } = await request.json()
  if (!message_id || !emoji) return NextResponse.json({ error: 'message_id and emoji required' }, { status: 400 })

  const { data: existing } = await supabase
    .from('reactions')
    .select('message_id')
    .eq('message_id', message_id)
    .eq('user_id', user.id)
    .eq('emoji', emoji)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('reactions')
      .delete()
      .eq('message_id', message_id)
      .eq('user_id', user.id)
      .eq('emoji', emoji)
    return NextResponse.json({ action: 'removed' })
  } else {
    await supabase
      .from('reactions')
      .insert({ message_id, user_id: user.id, emoji })
    return NextResponse.json({ action: 'added' })
  }
}
