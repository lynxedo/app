import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('board_members')
    .select('user_id, hub_users!user_id(id, display_name, avatar_url)')
    .eq('board_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members = (data ?? []).map((m: any) => m.hub_users).filter(Boolean)
  return NextResponse.json({ members })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: board } = await admin.from('boards').select('created_by').eq('id', id).single()
  if (!board) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (board.created_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { user_id } = await request.json()
  if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  const { error } = await admin
    .from('board_members')
    .upsert({ board_id: id, user_id }, { ignoreDuplicates: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
