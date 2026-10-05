import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { workOrderAccess } from '@/lib/work-order-access'

function r2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
    },
  })
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const { id, attachmentId } = await context.params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_admin_daily_log, can_access_daily_log_v2')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  // Work Orders only (lib/work-order-access.ts) — was: anyone in the company.
  if (!workOrderAccess(profile).canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const { data: attachment } = await admin
    .from('daily_log_stop_attachments')
    .select('id, storage_path, company_id, stop_id')
    .eq('id', attachmentId)
    .eq('stop_id', id)
    .single()

  if (!attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  if (attachment.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }

  // Best-effort R2 delete — don't fail the whole operation if R2 errors.
  try {
    const r2 = r2Client()
    await r2.send(new DeleteObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: attachment.storage_path,
    }))
  } catch {
    // Log and continue — the DB row removal is what matters for the UI.
    console.warn('[daily-log attachments] R2 delete failed for', attachment.storage_path)
  }

  const { error } = await admin
    .from('daily_log_stop_attachments')
    .delete()
    .eq('id', attachmentId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
