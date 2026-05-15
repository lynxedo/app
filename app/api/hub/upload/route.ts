import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

function getR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
    },
  })
}

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

  const maxBytes = 100 * 1024 * 1024
  if (file.size > maxBytes) return NextResponse.json({ error: 'File exceeds 100 MB limit' }, { status: 400 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
  const key = `hub/${profile.company_id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const r2 = getR2Client()

  await r2.send(new PutObjectCommand({
    Bucket: process.env.CF_R2_BUCKET_NAME!,
    Key: key,
    Body: buffer,
    ContentType: file.type || 'application/octet-stream',
    ContentDisposition: `inline; filename="${encodeURIComponent(file.name)}"`,
  }))

  return NextResponse.json({
    storage_path: key,
    filename: file.name,
    mime_type: file.type || 'application/octet-stream',
    size_bytes: file.size,
  })
}
