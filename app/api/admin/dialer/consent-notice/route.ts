import { NextResponse } from 'next/server'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

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

// POST  — upload (multipart/form-data, field "file")
// DELETE — clear; reverts to TTS text or spoken default
export async function POST(request: Request) {
  const ctx = await requireAdminArea('dialer')
  if (!ctx.ok || !ctx.company_id) {
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
  const key = `dialer/${ctx.company_id}/greeting/consent-${Date.now()}.${ext}`

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

  // Best-effort cleanup of the prior R2 object
  const { data: prior } = await admin
    .from('dialer_settings')
    .select('recording_consent_url')
    .eq('company_id', ctx.company_id)
    .maybeSingle()
  if (prior?.recording_consent_url) {
    const priorKey = extractKeyFromUrl(prior.recording_consent_url)
    if (priorKey && priorKey !== key) {
      r2.send(new DeleteObjectCommand({
        Bucket: process.env.CF_R2_BUCKET_NAME!,
        Key: priorKey,
      })).catch(() => {})
    }
  }

  await admin
    .from('dialer_settings')
    .upsert(
      { company_id: ctx.company_id, recording_consent_url: url, updated_at: new Date().toISOString() },
      { onConflict: 'company_id' }
    )

  return NextResponse.json({ url, storage_path: key })
}

export async function DELETE() {
  const ctx = await requireAdminArea('dialer')
  if (!ctx.ok || !ctx.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: prior } = await admin
    .from('dialer_settings')
    .select('recording_consent_url')
    .eq('company_id', ctx.company_id)
    .maybeSingle()

  if (prior?.recording_consent_url && process.env.CF_R2_ACCESS_KEY_ID) {
    const priorKey = extractKeyFromUrl(prior.recording_consent_url)
    if (priorKey) {
      r2Client().send(new DeleteObjectCommand({
        Bucket: process.env.CF_R2_BUCKET_NAME!,
        Key: priorKey,
      })).catch(() => {})
    }
  }

  await admin
    .from('dialer_settings')
    .upsert(
      { company_id: ctx.company_id, recording_consent_url: null, updated_at: new Date().toISOString() },
      { onConflict: 'company_id' }
    )

  return NextResponse.json({ ok: true })
}

function extractKeyFromUrl(url: string): string | null {
  const marker = '/api/dialer/media/'
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  return url.slice(idx + marker.length)
}
