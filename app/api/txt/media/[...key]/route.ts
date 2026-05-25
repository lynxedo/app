import { NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// GET /api/txt/media/[...key]
//
// Public-read media endpoint for txt attachments. Used in two places:
//   1. Twilio MMS fetch — when sending outbound MMS, Twilio HTTPS-GETs the
//      MediaUrl with no auth. This route gives Twilio a URL it can fetch.
//   2. In-app rendering of inbound + outbound media in TxtConversationView.
//
// Security model: deliberately public. The R2 key path includes a random
// 11-char slug after the timestamp (Math.random().toString(36).slice(2)),
// so URLs are unguessable. Acceptable for SMS attachments since the same
// media is delivered over plaintext SMS anyway. If a tenant ever needs
// stricter access, this is where we'd add HMAC-signed expiring URLs.
//
// We only serve keys under `txt/` to avoid this route accidentally exposing
// other content in the same R2 bucket (e.g. hub/* uploads).

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key: keyParts } = await params
  const key = keyParts.join('/')

  if (!key.startsWith('txt/')) {
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

  // 1-hour signed URL is plenty — Twilio fetches within seconds. Browser
  // rendering of in-app messages will hit a fresh signed URL each load.
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
