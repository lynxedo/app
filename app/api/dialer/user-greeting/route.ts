import { NextResponse } from 'next/server'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const ALLOWED_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
])
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

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

// POST  — upload the caller's own voicemail greeting
// DELETE — clear it (falls back to a spoken default named after the user)
//
// Self-scoped — operates on the authenticated user's user_profiles row only.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, company_id, can_access_dialer')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_dialer || !profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds 2 MB limit (got ${(file.size / 1024 / 1024).toFixed(1)} MB)` },
      { status: 400 }
    )
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: 'Only MP3 and WAV audio are supported' },
      { status: 400 }
    )
  }

  const ext = file.type.includes('wav') ? 'wav' : 'mp3'
  const key = `dialer/${profile.company_id}/greeting/user-${user.id}-${Date.now()}.${ext}`

  const r2 = r2Client()
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: key,
      Body: Buffer.from(await file.arrayBuffer()),
      ContentType: file.type,
    })
  )

  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/dialer/media/${key}`

  const admin = createAdminClient()

  // Sweep the prior greeting object to avoid orphan accumulation.
  const { data: prior } = await admin
    .from('user_profiles')
    .select('voicemail_greeting_url')
    .eq('id', user.id)
    .maybeSingle()
  if (prior?.voicemail_greeting_url) {
    const priorKey = extractKeyFromUrl(prior.voicemail_greeting_url)
    if (priorKey && priorKey !== key) {
      r2.send(new DeleteObjectCommand({
        Bucket: process.env.CF_R2_BUCKET_NAME!,
        Key: priorKey,
      })).catch(() => {})
    }
  }

  await admin
    .from('user_profiles')
    .update({ voicemail_greeting_url: url })
    .eq('id', user.id)

  return NextResponse.json({ url, storage_path: key })
}

export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: prior } = await admin
    .from('user_profiles')
    .select('voicemail_greeting_url')
    .eq('id', user.id)
    .maybeSingle()

  if (prior?.voicemail_greeting_url && process.env.CF_R2_ACCESS_KEY_ID) {
    const priorKey = extractKeyFromUrl(prior.voicemail_greeting_url)
    if (priorKey) {
      r2Client().send(new DeleteObjectCommand({
        Bucket: process.env.CF_R2_BUCKET_NAME!,
        Key: priorKey,
      })).catch(() => {})
    }
  }

  await admin
    .from('user_profiles')
    .update({ voicemail_greeting_url: null })
    .eq('id', user.id)

  return NextResponse.json({ ok: true })
}

function extractKeyFromUrl(url: string): string | null {
  const marker = '/api/dialer/media/'
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  return url.slice(idx + marker.length)
}
