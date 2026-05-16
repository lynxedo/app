import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: announcement_id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { emoji } = await request.json()
  if (!emoji) return NextResponse.json({ error: 'emoji required' }, { status: 400 })

  const { data: existing } = await supabase
    .from('announcement_reactions')
    .select('announcement_id')
    .eq('announcement_id', announcement_id)
    .eq('user_id', user.id)
    .eq('emoji', emoji)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('announcement_reactions')
      .delete()
      .eq('announcement_id', announcement_id)
      .eq('user_id', user.id)
      .eq('emoji', emoji)
    return NextResponse.json({ action: 'removed' })
  } else {
    await supabase
      .from('announcement_reactions')
      .insert({ announcement_id, user_id: user.id, emoji })
    return NextResponse.json({ action: 'added' })
  }
}
