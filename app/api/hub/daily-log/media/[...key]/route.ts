import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Auth-gated signed-URL redirect for daily-log attachment files.
// Key must start with "daily-log/" to prevent serving unrelated R2 objects.

export async function GET(
  _req: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { key: keyParts } = await context.params
  const key = keyParts.join('/')

  if (!key.startsWith('daily-log/')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
    new GetObjectCommand({ Bucket: process.env.CF_R2_BUCKET_NAME!, Key: key }),
    { expiresIn: 3600 },
  )

  return NextResponse.redirect(signedUrl, 307)
}
