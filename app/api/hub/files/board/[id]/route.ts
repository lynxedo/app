import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getR2Client } from '@/lib/r2'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'


export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()

  const { data: att } = await supabase
    .from('board_item_attachments')
    .select('storage_path, filename, mime_type')
    .eq('id', id)
    .eq('company_id', profile?.company_id)
    .single()

  if (!att) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
  }

  const r2 = getR2Client()

  if (new URL(request.url).searchParams.get('inline') === 'pdf') {
    const obj = await r2.send(new GetObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: att.storage_path,
    }))
    const bytes = await obj.Body?.transformToByteArray()
    if (!bytes) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': att.mime_type || 'application/pdf',
        'Content-Disposition': `inline; filename="${encodeURIComponent(att.filename)}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  }

  const url = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: att.storage_path,
    }),
    { expiresIn: 3600 }
  )

  return NextResponse.redirect(url, {
    headers: { 'Cache-Control': 'private, max-age=3600' },
  })
}
