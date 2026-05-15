import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data, error } = await supabase
    .from('messages')
    .select(`
      id, content, created_at, edited_at, parent_id, room_id, conversation_id,
      sender:hub_users!sender_id (id, display_name, avatar_url, is_bot),
      reactions (message_id, user_id, emoji),
      files (id, filename, mime_type, size_bytes, storage_path)
    `)
    .eq('conversation_id', id)
    .is('parent_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const messages = (data ?? []).reverse()
  return NextResponse.json({ messages })
}
