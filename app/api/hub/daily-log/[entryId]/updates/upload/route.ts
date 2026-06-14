import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getR2Client } from '@/lib/r2'


export async function POST(
  request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const maxBytes = 50 * 1024 * 1024
  if (file.size > maxBytes) return NextResponse.json({ error: 'File exceeds 50 MB limit' }, { status: 400 })

  const { entryId } = await params
  const nameParts = file.name.split('.')
  const ext = nameParts.length > 1 ? nameParts.pop()!.toLowerCase() : 'bin'
  const rand = Math.random().toString(36).slice(2, 8)
  const key = `daily-log/${profile.company_id}/updates/${entryId}/${Date.now()}-${rand}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())

  await getR2Client().send(new PutObjectCommand({
    Bucket: process.env.CF_R2_BUCKET_NAME!,
    Key: key,
    Body: buffer,
    ContentType: file.type || 'application/octet-stream',
    ContentDisposition: `inline; filename="${encodeURIComponent(file.name)}"`,
  }))

  return NextResponse.json({ key, name: file.name, type: file.type, size: file.size })
}
