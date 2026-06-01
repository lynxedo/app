import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> }
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

  const { key: segments } = await params
  const key = segments.join('/')

  // Key must be a daily-log attachment belonging to this company
  if (!key.startsWith(`daily-log/${profile.company_id}/`)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
  }

  const fileName = segments[segments.length - 1]

  // In-app PDF preview reads bytes same-origin (pdf.js can't read a cross-origin
  // redirect to R2 due to CORS). Stream the object instead of redirecting.
  if (new URL(request.url).searchParams.get('inline') === 'pdf') {
    const obj = await getR2Client().send(new GetObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: key,
    }))
    const bytes = await obj.Body?.transformToByteArray()
    if (!bytes) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  }

  const url = await getSignedUrl(
    getR2Client(),
    new GetObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: key,
      ResponseContentDisposition: `inline; filename="${encodeURIComponent(fileName)}"`,
    }),
    { expiresIn: 3600 }
  )

  // ?json=1 returns the signed URL as JSON so the client can open it
  // via window.open() — avoids the mobile/Capacitor issue where target="_blank"
  // opens in the system browser without session cookies.
  if (new URL(request.url).searchParams.has('json')) {
    return NextResponse.json({ url })
  }

  return NextResponse.redirect(url, {
    headers: { 'Cache-Control': 'private, max-age=3600' },
  })
}
