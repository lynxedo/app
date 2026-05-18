import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()

  const { data: file } = await supabase
    .from('files')
    .select('storage_path, filename, mime_type')
    .eq('id', id)
    .eq('company_id', profile?.company_id)
    .single()

  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
  }

  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
    },
  })

  const url = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: file.storage_path,
    }),
    { expiresIn: 3600 }
  )

  return NextResponse.redirect(url, {
    headers: { 'Cache-Control': 'private, max-age=3600' },
  })
}
