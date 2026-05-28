import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf',
  'video/mp4', 'video/quicktime', 'video/hevc',
])
const MAX_SIZE = 20 * 1024 * 1024 // 20 MB

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

async function authResolve(stopId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return { error: 'Profile not found', status: 404 as const }

  const admin = createAdminClient()
  const { data: stop } = await admin
    .from('daily_log_stops')
    .select('id, daily_log_entries!inner(company_id)')
    .eq('id', stopId)
    .single()
  if (!stop) return { error: 'Stop not found', status: 404 as const }

  const entry = Array.isArray(stop.daily_log_entries)
    ? stop.daily_log_entries[0]
    : stop.daily_log_entries
  if (!entry || entry.company_id !== profile.company_id) {
    return { error: 'Stop not found', status: 404 as const }
  }
  return { admin, stop, userId: user.id, companyId: profile.company_id }
}

// GET — list attachments for a stop.
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const resolved = await authResolve(id)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { admin } = resolved

  const { data, error } = await admin
    .from('daily_log_stop_attachments')
    .select('id, file_name, file_type, file_size, file_url, created_at, uploaded_by')
    .eq('stop_id', id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ attachments: data ?? [] })
}

// POST — upload a file attachment to R2 and record it.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const resolved = await authResolve(id)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { admin, userId, companyId } = resolved

  const formData = await request.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'Multipart form required' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File exceeds 20 MB limit' }, { status: 400 })
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin'
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  const key = `daily-log/${companyId}/${id}/${Date.now()}-${safeName}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const r2 = r2Client()
  await r2.send(new PutObjectCommand({
    Bucket: process.env.CF_R2_BUCKET_NAME!,
    Key: key,
    Body: buffer,
    ContentType: file.type || 'application/octet-stream',
  }))

  const fileUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/hub/daily-log/media/${encodeURIComponent(key)}`

  const { data: inserted, error } = await admin
    .from('daily_log_stop_attachments')
    .insert({
      stop_id: id,
      company_id: companyId,
      uploaded_by: userId,
      file_name: file.name.slice(0, 255),
      file_type: file.type,
      file_size: file.size,
      storage_path: key,
      file_url: fileUrl,
    })
    .select('id, file_name, file_type, file_size, file_url, created_at, uploaded_by')
    .single()

  if (error || !inserted) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }

  void ext // used implicitly in key
  return NextResponse.json({ attachment: inserted })
}
