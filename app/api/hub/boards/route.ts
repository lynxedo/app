import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: boards, error } = await supabase
    .from('boards')
    .select('id, name, is_private, is_personal, created_by, created_at')
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ boards: boards ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { name, is_private, is_personal } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const { data: board, error } = await supabase
    .from('boards')
    .insert({
      company_id: profile.company_id,
      name: name.trim(),
      is_private: is_private ?? false,
      is_personal: is_personal ?? false,
      created_by: user.id,
    })
    .select('id, name, is_private, is_personal, created_by, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Add creator as member
  await supabase.from('board_members').insert({ board_id: board.id, user_id: user.id })

  return NextResponse.json(board, { status: 201 })
}
