import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

// POST /api/txt/upload
// Auth-gated upload for outbound MMS attachments. Stored under txt/{company_id}/...
// mirroring the inbound webhook's R2 key layout so the public media route
// (/api/txt/media/[...key]) serves both inbound + outbound from the same place.
//
// MMS spec: Twilio supports image/jpeg, image/png, image/gif (broadest US carrier
// support). 5 MB cap per media per Twilio docs. We accept the same set + webp
// because some carriers handle it; Twilio will return a clear error if rejected.

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

const MAX_BYTES = 5 * 1024 * 1024 // Twilio MMS hard cap

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds 5 MB MMS limit (got ${(file.size / 1024 / 1024).toFixed(1)} MB)` },
      { status: 400 }
    )
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: 'Only JPEG, PNG, GIF, and WebP images are supported for MMS' },
      { status: 400 }
    )
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin'
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'bin'
  const key = `txt/${profile.company_id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExt}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
    },
  })
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: file.type || 'application/octet-stream',
    })
  )

  return NextResponse.json({
    storage_path: key,
    filename: file.name,
    mime_type: file.type || 'application/octet-stream',
    size_bytes: file.size,
  })
}
