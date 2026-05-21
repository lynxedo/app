import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Called by VPS cron every minute via:
// curl -s -X POST https://lynxedo.com/api/hub/scheduled-messages/deliver \
//   -H "x-cron-secret: $CRON_SECRET"

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data: due, error } = await admin
    .from('scheduled_messages')
    .select('id, company_id, room_id, conversation_id, sender_id, content, files')
    .lte('send_at', now)
    .is('sent_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) return NextResponse.json({ delivered: 0 })

  let delivered = 0
  for (const sm of due) {
    const { error: insertErr } = await admin.from('messages').insert({
      company_id: sm.company_id,
      room_id: sm.room_id ?? null,
      conversation_id: sm.conversation_id ?? null,
      sender_id: sm.sender_id,
      content: sm.content,
      parent_id: null,
      forwarded_from: null,
    })

    if (insertErr) continue

    // Auto-unarchive the DM for all members on new activity
    if (sm.conversation_id) {
      await admin
        .from('conversation_members')
        .update({ archived_at: null })
        .eq('conversation_id', sm.conversation_id)
        .not('archived_at', 'is', null)
    }

    // If there were files, we'd need to re-attach them — for now files are stored
    // in the scheduled_messages.files jsonb but inserting into files table requires
    // the message id. Handle inline:
    if (sm.files && Array.isArray(sm.files) && sm.files.length > 0) {
      const { data: msg } = await admin
        .from('messages')
        .select('id')
        .eq('company_id', sm.company_id)
        .eq('sender_id', sm.sender_id)
        .eq('content', sm.content)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (msg) {
        await admin.from('files').insert(
          sm.files.map((f: { storage_path: string; filename: string; mime_type: string; size_bytes: number }) => ({
            company_id: sm.company_id,
            message_id: msg.id,
            uploader_id: sm.sender_id,
            storage_path: f.storage_path,
            filename: f.filename,
            mime_type: f.mime_type,
            size_bytes: f.size_bytes,
          }))
        )
      }
    }

    await admin
      .from('scheduled_messages')
      .update({ sent_at: now })
      .eq('id', sm.id)

    delivered++
  }

  return NextResponse.json({ delivered })
}
