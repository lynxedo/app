import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxThreadPermissions } from '@/lib/inbox/permissions'
import { getInboxAccountById } from '@/lib/inbox/accounts'
import { getMailProvider } from '@/lib/inbox/provider'

export const dynamic = 'force-dynamic'
// Streaming a large attachment through can outlive the default budget.
export const maxDuration = 120

// Stored attachments jsonb rows: sync writes camelCase (contentType) but tolerate
// snake_case too — the migration comment documents content_type.
type StoredAttachment = {
  id?: string
  filename?: string
  contentType?: string
  content_type?: string
  size?: number
}

// RFC 6266-ish Content-Disposition with a safe ASCII fallback + UTF-8 extension.
function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'attachment'
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

// GET /api/hub/email/attachments/[messageId]/[attachmentId]
// messageId = OUR inbox_messages.id (uuid); attachmentId = the provider (Nylas)
// attachment id stored in that message's attachments jsonb.
//
// Auth: the caller must be able to VIEW the message's thread — the exact same
// gate the thread-detail route uses (RLS-scoped message read + canView). The
// bytes are proxy-streamed from Nylas; the client never sees a Nylas URL and the
// API key never leaves the server.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ messageId: string; attachmentId: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { messageId, attachmentId } = await params

  // Cookie-client read → the technician thread-scoped RLS boundary applies here
  // exactly as it does on the thread-detail route.
  const { data: msg } = await supabase
    .from('inbox_messages')
    .select('id, thread_id, account_id, provider_message_id, attachments')
    .eq('id', messageId)
    .maybeSingle()
  if (!msg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const perms = await getInboxThreadPermissions(supabase, msg.thread_id as string, user.id)
  if (!perms.canView) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // No blind proxying: the attachment id must exist on this message's stored jsonb.
  const stored = (Array.isArray(msg.attachments) ? msg.attachments : []) as StoredAttachment[]
  const att = stored.find((a) => a && a.id === attachmentId)
  if (!att) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const admin = createAdminClient()
  const account = await getInboxAccountById(admin, msg.account_id as string)
  if (!account) return NextResponse.json({ error: 'Mailbox not connected' }, { status: 400 })

  let download: { body: ReadableStream<Uint8Array> | null; contentType: string | null; contentLength: string | null }
  try {
    download = await getMailProvider(account).downloadAttachment(attachmentId, msg.provider_message_id as string)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[inbox:attachments] download failed', error)
    return NextResponse.json({ error: 'Attachment download failed' }, { status: 502 })
  }
  if (!download.body) {
    return NextResponse.json({ error: 'Attachment download failed' }, { status: 502 })
  }

  const filename = att.filename || 'attachment'
  const contentType = att.contentType || att.content_type || download.contentType || 'application/octet-stream'

  const headers = new Headers({
    'Content-Type': contentType,
    'Content-Disposition': contentDisposition(filename),
    'Cache-Control': 'private, no-store',
    // Force the browser to honor our Content-Type instead of sniffing the bytes,
    // so a mislabeled attachment can't be reinterpreted as active content.
    'X-Content-Type-Options': 'nosniff',
  })
  if (download.contentLength) headers.set('Content-Length', download.contentLength)

  return new Response(download.body, { headers })
}
