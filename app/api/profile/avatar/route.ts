import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getR2Client } from '@/lib/r2'


const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_BYTES = 5 * 1024 * 1024

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
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Only JPG, PNG, WebP, and GIF are allowed' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Image must be under 5 MB' }, { status: 400 })
  }

  const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]
  const key = `avatars/${user.id}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())
  await getR2Client().send(new PutObjectCommand({
    Bucket: process.env.CF_R2_BUCKET_NAME!,
    Key: key,
    Body: buffer,
    ContentType: file.type,
  }))

  // Store the R2 key — served via /api/profile/avatar/[userId]
  const { error } = await supabase
    .from('hub_users')
    .update({ avatar_url: key })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, serve_url: `/api/profile/avatar/${user.id}` })
}
