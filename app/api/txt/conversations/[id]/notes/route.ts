import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: conversationId } = await params
  const body = await request.json().catch(() => ({}))
  const text: string = (body.body || '').trim()
  if (!text) return NextResponse.json({ error: 'Empty note' }, { status: 400 })

  // Verify conversation exists in the user's company (RLS gives us this via SELECT)
  const { data: conv } = await supabase
    .from('txt_conversations')
    .select('id')
    .eq('id', conversationId)
    .maybeSingle()
  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  const admin = createAdminClient()
  const { data: note, error } = await admin
    .from('txt_notes')
    .insert({
      company_id: HEROES_COMPANY_ID,
      conversation_id: conversationId,
      body: text,
      created_by: user.id,
    })
    .select('id, body, created_at, created_by')
    .single()

  if (error || !note) {
    return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, note })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const noteId = url.searchParams.get('note_id')
  if (!noteId) return NextResponse.json({ error: 'note_id required' }, { status: 400 })

  // Verify ownership of note
  const { data: note } = await supabase
    .from('txt_notes')
    .select('id, created_by')
    .eq('id', noteId)
    .single()
  if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 })
  if (note.created_by !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  await admin.from('txt_notes').delete().eq('id', noteId)
  return NextResponse.json({ ok: true })
}
