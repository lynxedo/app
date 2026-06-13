import { NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// GET /api/dialer/media/[...key]
//
// Public-read endpoint for Twilio to fetch non-sensitive <Play> assets:
// voicemail greetings, the consent notice, and IVR prompts.
//
// Security model: deliberately public, but ALLOWLISTED to greeting/IVR folders.
// Keys are shaped `dialer/{companyId}/{folder}/{file}`. Call recordings
// (recordings/) and voicemails (voicemail/) are customer-sensitive and must
// NEVER be served from this public route — those go through the auth-gated
// /api/dialer/calls/[id]/recording route instead.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key: keyParts } = await params
  const key = keyParts.join('/')

  // Allowlist (default-deny): only greeting + IVR prompt folders are public.
  // Anything else — including recordings/ and voicemail/ — is refused.
  const segments = key.split('/')
  const folder = segments[2]
  const PUBLIC_FOLDERS = ['greeting', 'ivr']
  if (segments[0] !== 'dialer' || !PUBLIC_FOLDERS.includes(folder)) {
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
