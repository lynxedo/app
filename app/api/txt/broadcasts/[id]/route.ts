import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/txt/broadcasts/[id] — broadcast detail with recipients
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const [bResult, rResult] = await Promise.all([
    supabase
      .from('txt_broadcasts')
      .select(
        `id, body, status, recipient_count, sent_count, failed_count, skipped_count,
         created_by, created_at, started_at, completed_at, last_error, apply_signature,
         creator:hub_users!created_by ( id, display_name )`
      )
      .eq('id', id)
      .single(),
    supabase
      .from('txt_broadcast_recipients')
      .select(
        `id, status, error_message, processed_at, conversation_id, message_id,
         contact:txt_contacts!txt_broadcast_recipients_contact_id_fkey ( id, name, phone )`
      )
      .eq('broadcast_id', id)
      .order('processed_at', { ascending: false, nullsFirst: false })
      .limit(1000),
  ])

  if (bResult.error || !bResult.data) {
    return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })
  }

  return NextResponse.json({
    broadcast: bResult.data,
    recipients: rResult.data ?? [],
  })
}
