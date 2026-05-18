import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return NextResponse.json({ results: [] })

  const { data, error } = await supabase
    .from('messages')
    .select(`
      id,
      content,
      created_at,
      room_id,
      conversation_id,
      sender:hub_users!sender_id(display_name, avatar_url),
      room:rooms!room_id(name)
    `)
    .eq('company_id', profile.company_id)
    .ilike('content', `%${q}%`)
    .is('deleted_at', null)
    .is('parent_id', null)
    .order('created_at', { ascending: false })
    .limit(25)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ results: data ?? [] })
}
