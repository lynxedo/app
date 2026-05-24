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
      id, content, created_at, edited_at, parent_id, room_id, conversation_id, forwarded_from, source,
      sender:hub_users!sender_id (id, display_name, avatar_url, is_bot),
      reactions (message_id, user_id, emoji),
      files (id, filename, mime_type, size_bytes, storage_path, width_px, height_px)
    `)
    .eq('conversation_id', id)
    .is('parent_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []).reverse()

  // Enrich forwarded messages with original content
  const forwardedIds = rows.map((m: { forwarded_from: string | null }) => m.forwarded_from).filter(Boolean) as string[]
  let forwardedMap: Record<string, { id: string; content: string; sender: { display_name: string } | null; room_id: string | null; conversation_id: string | null }> = {}
  if (forwardedIds.length > 0) {
    const { data: originals } = await supabase
      .from('messages')
      .select('id, content, room_id, conversation_id, sender:hub_users!sender_id (display_name)')
      .in('id', forwardedIds)
    for (const o of originals ?? []) {
      const orig = o as { id: string; content: string; room_id: string | null; conversation_id: string | null; sender: { display_name: string } | { display_name: string }[] | null }
      const sender = Array.isArray(orig.sender) ? orig.sender[0] : orig.sender
      forwardedMap[orig.id] = { ...orig, sender }
    }
  }

  const messages = rows.map((m: { forwarded_from: string | null; [key: string]: unknown }) => ({
    ...m,
    forwarded_original: m.forwarded_from ? forwardedMap[m.forwarded_from] ?? null : null,
  }))

  return NextResponse.json({ messages })
}
