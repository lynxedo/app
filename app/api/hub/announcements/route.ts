import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('hub_announcements')
    .select(`
      id, content, created_at, expires_at,
      created_by_user:hub_users!created_by (display_name),
      reactions:announcement_reactions (announcement_id, user_id, emoji)
    `)
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ announcement: null })

  const raw = data as {
    id: string
    content: string
    created_at: string
    expires_at: string
    created_by_user: { display_name: string } | { display_name: string }[] | null
    reactions: { announcement_id: string; user_id: string; emoji: string }[]
  }
  const created_by_user = Array.isArray(raw.created_by_user) ? raw.created_by_user[0] : raw.created_by_user

  return NextResponse.json({ announcement: { ...raw, created_by_user } })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { content, expires_at } = await request.json()
  if (!content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 })
  if (!expires_at) return NextResponse.json({ error: 'expires_at required' }, { status: 400 })

  const { data, error } = await supabase
    .from('hub_announcements')
    .insert({
      company_id: profile.company_id,
      content: content.trim(),
      created_by: user.id,
      expires_at,
    })
    .select('id, content, created_at, expires_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
