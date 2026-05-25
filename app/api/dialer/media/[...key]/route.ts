import { NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// GET /api/dialer/media/[...key]
//
// Public-read endpoint for Twilio to fetch voicemail greetings via <Play>.
// Same shape as /api/txt/media/* but locked down to keys under `dialer/`
// (not txt/) so this route can't accidentally serve other R2 content.
//
// Security model: deliberately public. Keys include a millisecond timestamp,
// and greetings are short non-sensitive recordings.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key: keyParts } = await params
  const key = keyParts.join('/')

  if (!key.startsWith('dialer/')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

  const signedUrl = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: key,
    }),
    { expiresIn: 3600 }
  )

  return NextResponse.redirect(signedUrl, {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  })
}
