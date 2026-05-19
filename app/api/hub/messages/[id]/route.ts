import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { content } = await request.json()
  if (!content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'

  // Always use admin client to bypass RLS; enforce ownership at app layer for non-admins
  const adminDb = createAdminClient()
  const query = adminDb
    .from('messages')
    .update({ content: content.trim(), edited_at: new Date().toISOString() })
    .eq('id', id)

  const { data, error } = await (isAdmin ? query : query.eq('sender_id', user.id))
    .select('id, content, edited_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'

  // Always use admin client to bypass RLS; enforce ownership at app layer for non-admins
  const adminDb = createAdminClient()
  const query = adminDb
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  const { error } = isAdmin ? await query : await query.eq('sender_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
