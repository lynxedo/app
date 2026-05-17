import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

function getR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
    },
  })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId } = await params

  // Use admin client to read any user's hub_users row without RLS restriction
  const { data: hubUser } = await supabase
    .from('hub_users')
    .select('avatar_url')
    .eq('id', userId)
    .single()

  const key = hubUser?.avatar_url
  if (!key || key.startsWith('http')) {
    return NextResponse.json({ error: 'No avatar' }, { status: 404 })
  }

  const url = await getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: process.env.CF_R2_BUCKET_NAME!, Key: key }),
    { expiresIn: 3600 }
  )

  return NextResponse.redirect(url, {
    headers: { 'Cache-Control': 'private, max-age=3600' },
  })
}
