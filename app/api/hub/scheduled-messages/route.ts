import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('scheduled_messages')
    .select('id, content, send_at, sent_at, room_id, conversation_id, files')
    .eq('sender_id', user.id)
    .is('sent_at', null)
    .order('send_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data ?? []
  const roomIds = Array.from(new Set(rows.map(r => r.room_id).filter((id): id is string => !!id)))
  const convIds = Array.from(new Set(rows.map(r => r.conversation_id).filter((id): id is string => !!id)))

  const roomNames = new Map<string, string>()
  if (roomIds.length > 0) {
    const { data: rooms } = await supabase.from('rooms').select('id, name').in('id', roomIds)
    rooms?.forEach(r => roomNames.set(r.id, r.name))
  }

  const convLabels = new Map<string, string>()
  if (convIds.length > 0) {
    const { data: members } = await supabase
      .from('conversation_members')
      .select('conversation_id, user_id, hub_users:user_id(display_name)')
      .in('conversation_id', convIds)
    const byConv = new Map<string, { user_id: string; display_name: string | null }[]>()
    members?.forEach((m: { conversation_id: string; user_id: string; hub_users: { display_name: string | null } | { display_name: string | null }[] | null }) => {
      const hu = Array.isArray(m.hub_users) ? m.hub_users[0] : m.hub_users
      const arr = byConv.get(m.conversation_id) ?? []
      arr.push({ user_id: m.user_id, display_name: hu?.display_name ?? null })
      byConv.set(m.conversation_id, arr)
    })
    for (const [convId, arr] of byConv.entries()) {
      const others = arr.filter(a => a.user_id !== user.id)
      const target = others.length > 0 ? others : arr
      const names = target.map(t => t.display_name?.split(/\s+/)[0] ?? 'Unknown')
      convLabels.set(convId, names.length === 0 ? 'Me' : names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} & ${names.length - 2} more`)
    }
  }

  const enriched = rows.map(r => ({
    ...r,
    target_label: r.room_id
      ? `#${roomNames.get(r.room_id) ?? 'room'}`
      : r.conversation_id
        ? convLabels.get(r.conversation_id) ?? 'DM'
        : 'Unknown',
  }))

  return NextResponse.json({ scheduled: enriched })
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

  const body = await request.json()
  const { room_id, conversation_id, content, files, send_at } = body

  if (!content?.trim() && (!Array.isArray(files) || files.length === 0)) {
    return NextResponse.json({ error: 'content or files required' }, { status: 400 })
  }
  if (!room_id && !conversation_id) {
    return NextResponse.json({ error: 'room_id or conversation_id required' }, { status: 400 })
  }
  if (!send_at) return NextResponse.json({ error: 'send_at required' }, { status: 400 })

  const sendTime = new Date(send_at)
  if (sendTime <= new Date()) {
    return NextResponse.json({ error: 'send_at must be in the future' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('scheduled_messages')
    .insert({
      company_id: profile.company_id,
      room_id: room_id ?? null,
      conversation_id: conversation_id ?? null,
      sender_id: user.id,
      content: content?.trim() ?? '',
      files: files ?? null,
      send_at,
    })
    .select('id, send_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
