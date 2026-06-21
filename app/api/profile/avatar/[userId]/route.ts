import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getR2Client } from '@/lib/r2'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// The signed R2 URL is valid for this long; the 302 redirect is cached for a
// shorter window so a cached redirect can never outlive its signed URL (which
// would resolve to a 403 once the signature expired — a broken avatar).
const URL_TTL = 3600
const REDIRECT_CACHE = 600

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId } = await params

  // Admin client so we can read any user's hub_users row (e.g. the Guardian bot
  // or, later, cross-company members) without RLS restricting it to callers in
  // the same company.
  const admin = createAdminClient()
  const { data: hubUser } = await admin
    .from('hub_users')
    .select('avatar_url')
    .eq('id', userId)
    .single()

  const key = hubUser?.avatar_url
  if (!key) return NextResponse.json({ error: 'No avatar' }, { status: 404 })
  // Legacy Google/OAuth profile picture — redirect directly
  if (key.startsWith('http')) return NextResponse.redirect(key)

  const url = await getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: process.env.CF_R2_BUCKET_NAME!, Key: key }),
    { expiresIn: URL_TTL }
  )

  return NextResponse.redirect(url, {
    headers: { 'Cache-Control': `private, max-age=${REDIRECT_CACHE}` },
  })
}
