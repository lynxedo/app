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

  // Escape ilike wildcards so a literal % or _ in the query can't match everything.
  const escaped = q.replace(/[\\%_]/g, ch => `\\${ch}`)

  // Membership scoping comes from the messages_select RLS policy on the
  // user-session client (can_access_room / is_conversation_member).
  const { data, error } = await supabase
    .from('messages')
    .select(`
      id,
      content,
      created_at,
      room_id,
      conversation_id,
      parent_id,
      sender:hub_users!sender_id(display_name, avatar_url),
      room:rooms!room_id(name)
    `)
    .eq('company_id', profile.company_id)
    .ilike('content', `%${escaped}%`)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ results: data ?? [] })
}
