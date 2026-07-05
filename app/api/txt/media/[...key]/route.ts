import { NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@/lib/supabase/server'
import { verifyTxtMediaSignature } from '@/lib/txt-media-sign'

// GET /api/txt/media/[...key]
//
// Media endpoint for txt attachments (customer MMS photos — PII). Used in two
// places, each with its own gate (no more public-by-obscurity):
//   1. Twilio MMS fetch — outbound sends mint a short-TTL HMAC-signed URL
//      (lib/txt-media-sign.ts) since Twilio GETs the MediaUrl with no cookies.
//   2. In-app rendering (TxtConversationView, templates, admin) — the browser
//      sends session cookies; we require a logged-in user whose company owns
//      the key. Keys are always `txt/{company_id}/...` (both the upload route
//      and the inbound webhook write that layout).
//
// We only serve keys under `txt/` to avoid this route accidentally exposing
// other content in the same R2 bucket (e.g. hub/* uploads).

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key: keyParts } = await params
  const key = keyParts.join('/')

  if (!key.startsWith('txt/')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Gate 1: valid short-TTL signature (Twilio's cookieless MediaUrl fetch).
  const url = new URL(request.url)
  const signatureOk = verifyTxtMediaSignature(
    key,
    url.searchParams.get('exp'),
    url.searchParams.get('sig'),
  )

  // Gate 2: logged-in user whose company owns the key (in-app rendering).
  if (!signatureOk) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('company_id')
      .eq('id', user.id)
      .maybeSingle()
    if (!profile?.company_id || !key.startsWith(`txt/${profile.company_id}/`)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
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

  // `private` — this content is now access-gated; shared caches must not store it.
  return NextResponse.redirect(signedUrl, {
    headers: { 'Cache-Control': 'private, max-age=3600' },
  })
}
