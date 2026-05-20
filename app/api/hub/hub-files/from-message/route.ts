import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST { file_id, tags?: string[], description?: string }
// Saves an existing message attachment (files row) into the hub_files library,
// pointing at the same R2 object. No re-upload needed.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const fileId: string | undefined = body.file_id
  const rawTags = Array.isArray(body.tags) ? body.tags : []
  const tags: string[] = rawTags
    .map((t: unknown) => String(t).trim())
    .filter((t: string) => t.length > 0)
  const description: string | null = typeof body.description === 'string' && body.description.trim()
    ? body.description.trim()
    : null

  if (!fileId) return NextResponse.json({ error: 'file_id required' }, { status: 400 })

  // RLS on the files (attachments) table will enforce that the user can only
  // read attachments from messages they have access to.
  const { data: attachment, error: lookupErr } = await supabase
    .from('files')
    .select('id, company_id, storage_path, filename, mime_type, size_bytes')
    .eq('id', fileId)
    .single()

  if (lookupErr || !attachment) {
    return NextResponse.json({ error: 'Attachment not found or not accessible' }, { status: 404 })
  }
  if (attachment.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: row, error: insertErr } = await admin
    .from('hub_files')
    .insert({
      company_id: profile.company_id,
      uploader_id: user.id,
      storage_path: attachment.storage_path,
      filename: attachment.filename,
      mime_type: attachment.mime_type,
      size_bytes: attachment.size_bytes,
      description,
      tags,
    })
    .select('id, filename, mime_type, size_bytes, description, storage_path, uploaded_at, tags')
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })
  return NextResponse.json({ file: row }, { status: 201 })
}
