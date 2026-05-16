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
  return NextResponse.json({ scheduled: data ?? [] })
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
