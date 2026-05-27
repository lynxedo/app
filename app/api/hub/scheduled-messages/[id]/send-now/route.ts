import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: sm, error: lookupErr } = await supabase
    .from('scheduled_messages')
    .select('id, company_id, room_id, conversation_id, parent_id, sender_id, content, files, sent_at')
    .eq('id', id)
    .single()
  if (lookupErr || !sm) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (sm.sender_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (sm.sent_at) return NextResponse.json({ error: 'Already sent' }, { status: 400 })

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data: inserted, error: insertErr } = await admin
    .from('messages')
    .insert({
      company_id: sm.company_id,
      room_id: sm.room_id ?? null,
      conversation_id: sm.conversation_id ?? null,
      sender_id: sm.sender_id,
      content: sm.content,
      parent_id: sm.parent_id ?? null,
      forwarded_from: null,
    })
    .select('id')
    .single()
  if (insertErr || !inserted) return NextResponse.json({ error: insertErr?.message ?? 'insert failed' }, { status: 500 })

  // Auto-unarchive only for top-level messages, matches the live POST path.
  if (sm.conversation_id && !sm.parent_id) {
    await admin
      .from('conversation_members')
      .update({ archived_at: null })
      .eq('conversation_id', sm.conversation_id)
      .not('archived_at', 'is', null)
  }

  if (sm.files && Array.isArray(sm.files) && sm.files.length > 0) {
    await admin.from('files').insert(
      sm.files.map((f: { storage_path: string; filename: string; mime_type: string; size_bytes: number }) => ({
        company_id: sm.company_id,
        message_id: inserted.id,
        uploader_id: sm.sender_id,
        storage_path: f.storage_path,
        filename: f.filename,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
      }))
    )
  }

  await admin.from('scheduled_messages').update({ sent_at: now }).eq('id', sm.id)
  return NextResponse.json({ ok: true, message_id: inserted.id })
}
