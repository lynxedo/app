import { NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

const ALLOWED_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
])
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB — IVR prompts are short

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

// POST — upload a per-node IVR prompt audio file. Returns the public URL the
// IVR config should embed in node.prompt.audio_url. The admin UI is responsible
// for patching the ivr_config jsonb separately via /api/admin/dialer-settings.
//
// We don't try to GC orphaned R2 objects on prompt change here — the audio is
// owned by the ivr_config jsonb (no FK), and tracking which keys are referenced
// from inside a jsonb tree across edits gets messy. Cheap to leave them and
// sweep later if it becomes a real cost. Each upload uses a fresh timestamp so
// Twilio's <Play> cache always picks up the new file.
//
// Field name: "file". Optional "node_id" form field — included in the R2 key
// for human-readable debugging only; ignore if missing.
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
  const nodeId = (formData.get('node_id') as string | null) || 'node'
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
  const safeNodeId = nodeId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'node'
  const key = `dialer/${ctx.company_id}/ivr/${safeNodeId}-${Date.now()}.${ext}`

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
  return NextResponse.json({ url, storage_path: key })
}
