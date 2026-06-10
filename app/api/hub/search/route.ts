import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type SearchRow = {
  id: string
  content: string
  created_at: string
  room_id: string | null
  conversation_id: string | null
  parent_id: string | null
  sender_display_name: string | null
  sender_avatar_url: string | null
  room_name: string | null
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return NextResponse.json({ results: [] })

  // search_hub_messages is a SECURITY DEFINER RPC: it scopes results to the
  // caller's own rooms + DMs and uses the full-text index (idx_messages_fts),
  // so it stays fast on the 100K+-row messages table. A direct ILIKE scan timed
  // out at 8s under the per-row RLS membership checks.
  const { data, error } = await supabase.rpc('search_hub_messages', { p_query: q, p_limit: 30 })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Reshape the flat RPC rows into the nested shape the client expects.
  const results = ((data ?? []) as SearchRow[]).map(r => ({
    id: r.id,
    content: r.content,
    created_at: r.created_at,
    room_id: r.room_id,
    conversation_id: r.conversation_id,
    parent_id: r.parent_id,
    sender: r.sender_display_name
      ? { display_name: r.sender_display_name, avatar_url: r.sender_avatar_url }
      : null,
    room: r.room_name ? { name: r.room_name } : null,
  }))
  return NextResponse.json({ results })
}
