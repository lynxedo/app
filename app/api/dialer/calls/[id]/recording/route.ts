import { NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/dialer/calls/[id]/recording
// Returns a short-lived signed R2 URL for an authenticated user to stream the
// call recording. Only accessible to users with can_access_call_log2 or
// can_admin_dialer or role=admin.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_call_log2, can_admin_dialer, role, company_id')
    .eq('id', user.id)
    .single()

  if (!profile?.can_access_call_log2 && profile?.role !== 'admin' && !profile?.can_admin_dialer) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: call } = await admin
    .from('calls')
    .select('recording_storage_path, company_id')
    .eq('id', id)
    .eq('company_id', profile.company_id || '')
    .maybeSingle()

  if (!call?.recording_storage_path) {
    return NextResponse.json({ error: 'recording not found' }, { status: 404 })
  }

  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'storage not configured' }, { status: 501 })
  }

  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
    },
  })

  const signedUrl = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: call.recording_storage_path,
    }),
    { expiresIn: 3600 }
  )

  return NextResponse.redirect(signedUrl, {
    headers: { 'Cache-Control': 'private, max-age=3600' },
  })
}
