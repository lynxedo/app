import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getR2Client } from '@/lib/r2'


export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  // Optional image dimensions captured client-side via image.naturalWidth/Height
  // before upload. Lets the chat thumbnail reserve the right aspect ratio
  // before the image decodes, eliminating the scroll-jump glitch in
  // photo-heavy rooms. Non-image uploads omit these.
  const widthRaw = formData.get('width_px')
  const heightRaw = formData.get('height_px')
  const width_px = typeof widthRaw === 'string' && /^\d+$/.test(widthRaw) ? parseInt(widthRaw, 10) : null
  const height_px = typeof heightRaw === 'string' && /^\d+$/.test(heightRaw) ? parseInt(heightRaw, 10) : null

  const maxBytes = 100 * 1024 * 1024
  if (file.size > maxBytes) return NextResponse.json({ error: 'File exceeds 100 MB limit' }, { status: 400 })

  const ALLOWED_TYPES = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'text/html',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/mpeg', 'video/ogg',
    'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/aac', 'audio/flac',
    'application/vnd.android.package-archive', // Android APK (app install file)
  ])
  // Browsers frequently report an empty or generic MIME for some files — most
  // notably .apk (the OS doesn't map the extension to a MIME type) and some audio
  // files — so the MIME check alone would wrongly reject them. Fall back to an
  // extension allowlist when the reported MIME isn't one we recognize, and infer
  // the stored content-type from the extension so playback/preview still works.
  const ext = (file.name.includes('.') ? file.name.split('.').pop()! : 'bin').toLowerCase()
  const ALLOWED_EXT = new Set(['apk', 'mp3', 'm4a', 'wav', 'aac', 'flac', 'html', 'htm'])
  const EXT_MIME: Record<string, string> = {
    apk: 'application/vnd.android.package-archive',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', flac: 'audio/flac',
    html: 'text/html', htm: 'text/html',
  }
  if (!ALLOWED_TYPES.has(file.type) && !ALLOWED_EXT.has(ext)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
  }
  const resolvedMime = file.type || EXT_MIME[ext] || 'application/octet-stream'

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const key = `hub/${profile.company_id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const r2 = getR2Client()

  await r2.send(new PutObjectCommand({
    Bucket: process.env.CF_R2_BUCKET_NAME!,
    Key: key,
    Body: buffer,
    // Use the real MIME when the browser provided one; otherwise infer it from
    // the extension (e.g. .apk → installable package, .mp3 → audio/mpeg) so the
    // download / inline player behaves correctly.
    ContentType: resolvedMime,
    ContentDisposition: `inline; filename="${encodeURIComponent(file.name)}"`,
  }))

  return NextResponse.json({
    storage_path: key,
    filename: file.name,
    mime_type: resolvedMime,
    size_bytes: file.size,
    width_px,
    height_px,
  })
}
