import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { signRouteSheetToken, verifyRouteSheetToken } from '@/lib/route-sheet-token'

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
  { params }: { params: Promise<{ entryId: string }> }
) {
  const { entryId } = await params
  const sp = new URL(request.url).searchParams
  const token = sp.get('token')

  // Authorize via EITHER a logged-in session OR a valid signed token.
  // The token path is what lets the route sheet open in any browser — e.g. the
  // device's default browser launched from the iOS/Android app — without that
  // browser being signed into Lynxedo (it has no session cookie).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const tokenValid = verifyRouteSheetToken(entryId, token)

  if (!user && !tokenValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // A logged-in user reads under RLS (preserves the existing per-company access
  // boundary). A token-only request (no session) reads via the service role —
  // the unforgeable, entry-scoped token is the authorization.
  const db = user ? supabase : createAdminClient()
  const { data: entry } = await db
    .from('daily_log_entries')
    .select('route_sheet_url, route_sheet_name')
    .eq('id', entryId)
    .single()

  // ?grant=1 — the Hub app (authenticated) asks for a browser-independent URL to
  // open. Requires a real session (a token can't mint another token) and only
  // succeeds if the caller can actually see a route sheet on this entry.
  if (sp.get('grant') === '1') {
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!entry?.route_sheet_url) return NextResponse.json({ error: 'No route sheet attached' }, { status: 404 })
    const base = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const url = `${base}/api/hub/daily-log/${entryId}/route-sheet?token=${signRouteSheetToken(entryId)}`
    return NextResponse.json({ url })
  }

  if (!entry?.route_sheet_url) return NextResponse.json({ error: 'No route sheet attached' }, { status: 404 })

  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
  }

  const isHtml = entry.route_sheet_url.endsWith('.html')
  const fallbackName = isHtml ? 'route-sheet.html' : 'route-sheet.pdf'
  const r2 = getR2Client()

  if (isHtml) {
    // Proxy HTML content directly so the browser stays at lynxedo.com.
    // A redirect to the R2 signed URL would make the page load from
    // *.r2.cloudflarestorage.com — a different origin — so the Mapbox
    // Static Images <img> inside the sheet would carry an R2 referrer
    // and get blocked by the Mapbox token's URL restrictions. (This is also
    // why HTML sheets need the token above rather than just a signed R2 URL.)
    const obj = await r2.send(new GetObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: entry.route_sheet_url,
    }))
    const html = await obj.Body?.transformToString() ?? ''
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="${encodeURIComponent(entry.route_sheet_name ?? fallbackName)}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  }

  // PDF — redirect to a short-lived signed URL (no Mapbox origin concern). The
  // external browser follows the redirect to the self-authenticating signed URL.
  const url = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: entry.route_sheet_url,
      ResponseContentDisposition: `inline; filename="${encodeURIComponent(entry.route_sheet_name ?? fallbackName)}"`,
      ResponseContentType: 'application/pdf',
    }),
    { expiresIn: 3600 }
  )

  return NextResponse.redirect(url, {
    headers: { 'Cache-Control': 'private, max-age=3600' },
  })
}
