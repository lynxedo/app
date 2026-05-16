import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'crypto'

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

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('hub_files')
    .select(`
      id, filename, mime_type, size_bytes, description, storage_path, uploaded_at,
      uploader:hub_users!uploader_id (display_name)
    `)
    .order('uploaded_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const files = (data ?? []).map((f: {
    id: string
    filename: string
    mime_type: string
    size_bytes: number
    description: string | null
    storage_path: string
    uploaded_at: string
    uploader: { display_name: string } | { display_name: string }[] | null
  }) => ({
    ...f,
    uploader: Array.isArray(f.uploader) ? f.uploader[0] : f.uploader,
  }))

  return NextResponse.json({ files })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const description = (formData.get('description') as string | null)?.trim() || null

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const maxBytes = 100 * 1024 * 1024
  if (file.size > maxBytes) return NextResponse.json({ error: 'File exceeds 100 MB limit' }, { status: 400 })

  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
  const key = `hub-library/${profile.company_id}/${randomUUID()}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const r2 = getR2Client()

  await r2.send(new PutObjectCommand({
    Bucket: process.env.CF_R2_BUCKET_NAME!,
    Key: key,
    Body: buffer,
    ContentType: file.type || 'application/octet-stream',
    ContentDisposition: `attachment; filename="${encodeURIComponent(file.name)}"`,
  }))

  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('hub_files')
    .insert({
      company_id: profile.company_id,
      uploader_id: user.id,
      storage_path: key,
      filename: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
      description,
    })
    .select('id, filename, mime_type, size_bytes, description, storage_path, uploaded_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(row, { status: 201 })
}
